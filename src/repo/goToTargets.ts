import type { BookmarkRef } from './workspaceItems'

const GIT_REMOTE = 'git'

export interface BookmarkListRow {
  name: string
  remote: string | null
  present: boolean
  commitId: string | null
}

export interface BookmarkGoToItem {
  name: string
  label: string
  description: string
  revision?: string
}

export interface BookmarkChoice {
  label: string
  revision: string
}

export type BookmarkGoToResolution =
  | { kind: 'single'; revision: string }
  | { kind: 'ambiguous'; choices: readonly BookmarkChoice[] }
  | { kind: 'unknown' }

interface ListedBookmark {
  scope: string
  choice: BookmarkChoice
}

function listedBookmarks(
  name: string,
  local: readonly BookmarkRef[],
  remote: readonly BookmarkRef[],
): ListedBookmark[] {
  const locals = local
    .filter((bookmark) => bookmark.name === name)
    .map((bookmark) => ({
      scope: 'local',
      choice: { label: 'local', revision: bookmark.commitId },
    }))
  const remotes = remote
    .filter((bookmark) => bookmark.name === name && bookmark.remote)
    .map((bookmark) => ({
      scope: bookmark.remote ?? '',
      choice: { label: `${name}@${bookmark.remote}`, revision: bookmark.commitId },
    }))
  return [...locals, ...remotes]
}

export function bookmarkRefsFromList(rows: readonly BookmarkListRow[]): {
  local: BookmarkRef[]
  remote: BookmarkRef[]
} {
  const localSeen = new Set<string>()
  const remoteSeen = new Set<string>()
  const local: BookmarkRef[] = []
  const remote: BookmarkRef[] = []
  for (const row of rows) {
    if (!row.present || !row.commitId || row.remote === GIT_REMOTE) {
      continue
    }
    if (row.remote === null) {
      if (localSeen.has(row.name)) {
        continue
      }
      localSeen.add(row.name)
      local.push({ name: row.name, commitId: row.commitId })
      continue
    }
    const key = `${row.name}@${row.remote}`
    if (remoteSeen.has(key)) {
      continue
    }
    remoteSeen.add(key)
    remote.push({ name: row.name, remote: row.remote, commitId: row.commitId })
  }
  return { local, remote }
}

export function bookmarkVariants(
  name: string,
  local: readonly BookmarkRef[],
  remote: readonly BookmarkRef[],
): BookmarkChoice[] {
  return listedBookmarks(name, local, remote).map((entry) => entry.choice)
}

function bookmarkNames(local: readonly BookmarkRef[], remote: readonly BookmarkRef[]): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const bookmark of [...local, ...remote]) {
    if (seen.has(bookmark.name)) {
      continue
    }
    seen.add(bookmark.name)
    names.push(bookmark.name)
  }
  return names
}

function sharedRevision(choices: readonly BookmarkChoice[]): string | undefined {
  const revision = choices[0]?.revision
  if (!revision || choices.some((choice) => choice.revision !== revision)) {
    return undefined
  }
  return revision
}

export function bookmarkGoToItems(
  local: readonly BookmarkRef[],
  remote: readonly BookmarkRef[],
): BookmarkGoToItem[] {
  return bookmarkNames(local, remote).flatMap((name) => {
    const entries = listedBookmarks(name, local, remote)
    if (entries.length === 0) {
      return []
    }
    const revision = sharedRevision(entries.map((entry) => entry.choice))
    const hasLocal = entries.some((entry) => entry.scope === 'local')
    return [
      {
        name,
        label: `${hasLocal ? '$(bookmark)' : '$(cloud)'} ${name}`,
        description: entries.map((entry) => entry.scope).join(', '),
        ...(revision ? { revision } : {}),
      },
    ]
  })
}

export function resolveBookmarkGoTo(
  name: string,
  local: readonly BookmarkRef[],
  remote: readonly BookmarkRef[],
): BookmarkGoToResolution {
  const choices = bookmarkVariants(name, local, remote)
  if (choices.length === 0) {
    return { kind: 'unknown' }
  }
  const revision = sharedRevision(choices)
  if (!revision) {
    return { kind: 'ambiguous', choices }
  }
  return { kind: 'single', revision }
}
