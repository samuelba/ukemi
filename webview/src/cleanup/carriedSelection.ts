import type { CleanupSnapshot } from '../../../shared/cleanup'

export interface CleanupChoices {
  bookmarks: ReadonlySet<string>
  abandonCommits: ReadonlySet<string>
  deleted: ReadonlySet<string>
  deleteRemote: ReadonlySet<string>
  workspaces: ReadonlySet<string>
  deleteFiles: ReadonlySet<string>
  drops: ReadonlySet<string>
  undescribedDrops: ReadonlySet<string>
}

// An item is the same when nothing but its default changed.
function sameItem(a: object, b: object): boolean {
  return (
    JSON.stringify({ ...a, checked: undefined }) === JSON.stringify({ ...b, checked: undefined })
  )
}

// The user's choice stays for an item the new snapshot still offers unchanged. A new or changed
// item takes its default, so a choice never applies to something the user did not see.
function carry<T extends object>(
  selected: ReadonlySet<string>,
  previous: readonly T[],
  next: readonly T[],
  key: (item: T) => string,
  isDefault: (item: T) => boolean,
): Set<string> {
  const before = new Map(previous.map((item) => [key(item), item]))
  return new Set(
    next
      .filter((item) => {
        const old = before.get(key(item))
        return old && sameItem(old, item) ? selected.has(key(item)) : isDefault(item)
      })
      .map(key),
  )
}

function within(set: ReadonlySet<string>, allowed: ReadonlySet<string>): Set<string> {
  return new Set([...set].filter((name) => allowed.has(name)))
}

const revisions = (snapshot: CleanupSnapshot) => snapshot.divergent.flatMap((g) => g.revisions)

// The choices for a snapshot the host sent while the view was open, such as after a refresh.
// Without a previous snapshot, every item takes its default.
export function carriedChoices(
  choices: CleanupChoices,
  previous: CleanupSnapshot | null,
  next: CleanupSnapshot,
): CleanupChoices {
  const prev: CleanupSnapshot = previous ?? {
    bookmarks: [],
    deletedBookmarks: [],
    workspaces: [],
    divergent: [],
    undescribed: [],
    undescribedTruncated: false,
  }
  const bookmarks = carry(
    choices.bookmarks,
    prev.bookmarks,
    next.bookmarks,
    (b) => b.name,
    (b) => b.checked,
  )
  const deleted = carry(
    choices.deleted,
    prev.deletedBookmarks,
    next.deletedBookmarks,
    (b) => b.name,
    (b) => b.checked,
  )
  const workspaces = carry(
    choices.workspaces,
    prev.workspaces,
    next.workspaces,
    (w) => w.name,
    (w) => w.checked,
  )
  const never = () => false
  return {
    bookmarks,
    abandonCommits: within(
      carry(choices.abandonCommits, prev.bookmarks, next.bookmarks, (b) => b.name, never),
      bookmarks,
    ),
    deleted,
    deleteRemote: within(
      carry(
        choices.deleteRemote,
        prev.deletedBookmarks,
        next.deletedBookmarks,
        (b) => b.name,
        never,
      ),
      deleted,
    ),
    workspaces,
    deleteFiles: within(
      carry(choices.deleteFiles, prev.workspaces, next.workspaces, (w) => w.name, never),
      workspaces,
    ),
    drops: carry(
      choices.drops,
      revisions(prev),
      revisions(next),
      (r) => r.commitId,
      (r) => r.checked,
    ),
    undescribedDrops: carry(
      choices.undescribedDrops,
      prev.undescribed,
      next.undescribed,
      (u) => u.commitId,
      never,
    ),
  }
}
