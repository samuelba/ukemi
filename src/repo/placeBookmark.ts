import type { LocalBookmark } from '../../shared/model'
import type { CommitView } from '../../shared/protocol'
import type { ParsedBookmark } from '../jj/parse'
import { firstLine } from '../util/text'

export interface BookmarkPlacement {
  commits: CommitView[]
  bookmarks: ParsedBookmark[]
  hasUnpushed: boolean
}

export function placeBookmark(
  commits: readonly CommitView[],
  bookmarks: readonly ParsedBookmark[],
  name: string,
  commitId: string,
  hasRemotes: boolean,
): BookmarkPlacement {
  const synced = !hasRemotes
  const nextCommits = commits.map((commit) => relocate(commit, name, commitId, synced))
  const target = nextCommits.find((commit) => commit.commitId === commitId)
  return {
    commits: nextCommits,
    bookmarks: moveRow(bookmarks, name, commitId, target ? firstLine(target.description) : ''),
    hasUnpushed:
      hasRemotes && nextCommits.some((commit) => commit.localBookmarks.some((b) => !b.synced)),
  }
}

function relocate(commit: CommitView, name: string, commitId: string, synced: boolean): CommitView {
  const kept = commit.localBookmarks.filter((bookmark) => bookmark.name !== name)
  if (commit.commitId !== commitId) {
    return kept.length === commit.localBookmarks.length
      ? commit
      : { ...commit, localBookmarks: kept }
  }
  const local: LocalBookmark = { name, synced, conflict: false }
  return { ...commit, localBookmarks: [...kept, local] }
}

function moveRow(
  bookmarks: readonly ParsedBookmark[],
  name: string,
  commitId: string,
  description: string,
): ParsedBookmark[] {
  let found = false
  const next = bookmarks.map((bookmark) => {
    if (bookmark.remote !== null || bookmark.name !== name) {
      return bookmark
    }
    found = true
    return { ...bookmark, commitId, description, present: true, conflict: false }
  })
  if (found) {
    return next
  }
  return [
    ...next,
    {
      name,
      remote: null,
      present: true,
      conflict: false,
      tracked: false,
      commitId,
      description,
      inTrunk: false,
    },
  ]
}
