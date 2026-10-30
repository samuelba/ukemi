import { quoteRevsetString } from '../jj/revsets'
import type { JjRepo } from '../jj/repo'

interface MovedBookmark {
  name: string
  local: string
  remotes: string[]
  isSameContent: boolean
}

// After a fetch, a bookmark that moved both locally and on the remote is conflicted. GitHub does this
// to the rest of a stack when a request is merged: it rebases the remaining branches itself.
async function movedBookmarks(
  repo: JjRepo,
  conflicted: ReadonlySet<string>,
  names: readonly string[],
): Promise<MovedBookmark[]> {
  const moved: MovedBookmark[] = []
  for (const name of new Set(names)) {
    if (!conflicted.has(name)) {
      continue
    }
    const quoted = quoteRevsetString(name)
    const [locals, remotes] = await Promise.all([
      repo.commitIds(`bookmarks(exact:${quoted}) ~ remote_bookmarks(exact:${quoted})`),
      repo.commitIds(`remote_bookmarks(exact:${quoted})`),
    ])
    const [local] = locals
    if (locals.length !== 1 || local === undefined || remotes.length === 0) {
      continue
    }
    const diffs = await Promise.all(remotes.map((remote) => repo.diffFiles(remote, local)))
    moved.push({ name, local, remotes, isSameContent: diffs.every((files) => files.length === 0) })
  }
  return moved
}

export interface ResolvedBookmarks {
  resolved: string[]
  skipped: string[]
  // The remote copies that were replaced by an identical local change.
  replaced: string[]
}

/**
 * Revset for replaced remote copies that nothing points at any more. After the push they would
 * otherwise stay behind as a divergent twin of the local change.
 */
export function leftoverCopies(commitIds: readonly string[]): string {
  const ids = commitIds.map(quoteRevsetString).join(' | ')
  return `(${ids}) & mutable() ~ ::(bookmarks() | remote_bookmarks() | working_copies())`
}

/**
 * Points conflicted bookmarks back at the local change so a push replaces the remote branch. A remote
 * branch with the same content as the local one is replaced silently. Otherwise someone may have
 * pushed real work, so the bookmarks are only moved when `confirmOverwrite` agrees.
 */
export async function resolveMovedBookmarks(
  repo: JjRepo,
  conflicted: ReadonlySet<string>,
  names: readonly string[],
  confirmOverwrite?: (branches: string[]) => Promise<boolean>,
): Promise<ResolvedBookmarks> {
  const moved = await movedBookmarks(repo, conflicted, names)
  const differing = moved.filter((m) => !m.isSameContent).map((m) => m.name)
  const allowed = differing.length === 0 || (await confirmOverwrite?.(differing)) === true
  const resolved: string[] = []
  const skipped: string[] = []
  const replaced: string[] = []
  for (const bookmark of moved) {
    if (bookmark.isSameContent || allowed) {
      await repo.setBookmark(bookmark.name, bookmark.local)
      resolved.push(bookmark.name)
      if (bookmark.isSameContent) {
        replaced.push(...bookmark.remotes)
      }
    } else {
      skipped.push(bookmark.name)
    }
  }
  return { resolved, skipped, replaced }
}
