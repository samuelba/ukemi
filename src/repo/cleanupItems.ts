import type {
  CleanupBookmark,
  CleanupDeletedBookmark,
  CleanupDivergence,
  CleanupRevision,
  CleanupSelection,
  CleanupSnapshot,
  CleanupUndescribed,
  CleanupWorkspace,
} from '../../shared/cleanup'

const GIT_REMOTE = 'git'

export interface BookmarkRecord {
  name: string
  remote: string | null
  present: boolean
  conflict: boolean
  tracked: boolean
  description: string
  inTrunk: boolean
}

export interface WorkspaceRecord {
  name: string
  description: string
  isEmpty: boolean
  isCurrent: boolean
  isOpen: boolean
  rootMissing: boolean
}

export interface DivergentCommit {
  changeId: string
  changePrefix: string
  commitId: string
  commitPrefix: string
  parents: readonly string[]
  description: string
  timestamp: string
  isWorkingCopy: boolean
  isImmutable: boolean
  isDivergent: boolean
}

export interface UndescribedCommit {
  changePrefix: string
  commitId: string
  commitPrefix: string
  description: string
  timestamp: string
  isWorkingCopy: boolean
  isEmpty: boolean
  isImmutable: boolean
}

export type CleanupStep =
  | { kind: 'pushDeletedBookmark'; name: string }
  | { kind: 'forgetBookmark'; name: string }
  | { kind: 'rebase'; revset: string; onto: string }
  | { kind: 'abandon'; commitId: string }
  | { kind: 'forgetWorkspace'; name: string }

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? ''
}

function byName(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name)
}

function trackedRemotesDeleted(name: string, rows: readonly BookmarkRecord[]): boolean {
  const tracked = rows.filter(
    (row) => row.name === name && row.remote !== null && row.remote !== GIT_REMOTE && row.tracked,
  )
  return tracked.length > 0 && tracked.every((row) => !row.present)
}

function bookmarkItem(
  local: BookmarkRecord,
  rows: readonly BookmarkRecord[],
  trunkName: string | null,
): CleanupBookmark | null {
  const description = firstLine(local.description)
  if (trackedRemotesDeleted(local.name, rows)) {
    return {
      name: local.name,
      reason: 'deleted-remote',
      detail: 'Remote bookmark was deleted.',
      description,
      checked: true,
    }
  }
  if (local.conflict) {
    return {
      name: local.name,
      reason: 'conflict',
      detail: 'Bookmark is conflicted.',
      description,
      checked: false,
    }
  }
  if (local.inTrunk) {
    const where = trunkName ? `Already in trunk (${trunkName}).` : 'Already in trunk.'
    return { name: local.name, reason: 'merged', detail: where, description, checked: true }
  }
  return null
}

export function classifyBookmarks(
  rows: readonly BookmarkRecord[],
  trunkName: string | null,
): CleanupBookmark[] {
  const locals = rows
    .filter((row) => row.remote === null && row.present)
    .filter((row) => trunkName === null || row.name !== trunkName)
    .sort(byName)
  const items: CleanupBookmark[] = []
  for (const local of locals) {
    const item = bookmarkItem(local, rows, trunkName)
    if (item) {
      items.push(item)
    }
  }
  return items
}

function liveTrackedRemotes(name: string, rows: readonly BookmarkRecord[]): string[] {
  return [
    ...new Set(
      rows.flatMap((row) =>
        row.name === name &&
        row.remote !== null &&
        row.remote !== GIT_REMOTE &&
        row.tracked &&
        row.present
          ? [row.remote]
          : [],
      ),
    ),
  ].sort((left, right) => left.localeCompare(right))
}

function deletedDetail(name: string, remotes: readonly string[]): string {
  if (remotes.length === 0) {
    return 'No remote bookmark.'
  }
  return `Push deletes ${remotes.map((remote) => `${name}@${remote}`).join(', ')}.`
}

export function classifyDeletedBookmarks(
  rows: readonly BookmarkRecord[],
): CleanupDeletedBookmark[] {
  return rows
    .filter((row) => row.remote === null && !row.present)
    .sort(byName)
    .map((row) => {
      const remotes = liveTrackedRemotes(row.name, rows)
      return {
        name: row.name,
        remotes,
        detail: deletedDetail(row.name, remotes),
        checked: true,
        canDeleteRemote: remotes.length > 0,
      }
    })
}

function isBlank(text: string): boolean {
  return firstLine(text).length === 0
}

function isVirtualRoot(commitId: string): boolean {
  return /^0+$/.test(commitId)
}

export function classifyUndescribed(commits: readonly UndescribedCommit[]): CleanupUndescribed[] {
  return commits
    .filter(
      (commit) =>
        !commit.isWorkingCopy && !isVirtualRoot(commit.commitId) && isBlank(commit.description),
    )
    .map((commit) => ({
      commitId: commit.commitId,
      changePrefix: commit.changePrefix,
      commitPrefix: commit.commitPrefix,
      timestamp: commit.timestamp,
      isEmpty: commit.isEmpty,
      isImmutable: commit.isImmutable,
    }))
}

function workspaceDetail(row: WorkspaceRecord): string {
  if (row.rootMissing) {
    return 'Working copy folder is missing.'
  }
  if (row.isEmpty) {
    return '(empty)'
  }
  const line = firstLine(row.description)
  return line.length > 0 ? line : '(no description)'
}

export function classifyWorkspaces(rows: readonly WorkspaceRecord[]): CleanupWorkspace[] {
  return rows
    .filter((row) => !row.isCurrent && !row.isOpen)
    .sort(byName)
    .map((row) => ({
      name: row.name,
      detail: workspaceDetail(row),
      checked: row.rootMissing,
    }))
}

function childCommitIds(commitId: string, commits: readonly DivergentCommit[]): string[] {
  return [
    ...new Set(
      commits
        .filter((commit) => commit.commitId !== commitId && commit.parents.includes(commitId))
        .map((commit) => commit.commitId),
    ),
  ]
}

function toRevision(commit: DivergentCommit, commits: readonly DivergentCommit[]): CleanupRevision {
  const children = childCommitIds(commit.commitId, commits)
  const hasImmutableChild = commits.some(
    (other) => other.parents.includes(commit.commitId) && other.isImmutable,
  )
  return {
    commitId: commit.commitId,
    commitPrefix: commit.commitPrefix,
    description: firstLine(commit.description),
    timestamp: commit.timestamp,
    isWorkingCopy: commit.isWorkingCopy,
    canDrop: !commit.isImmutable && !hasImmutableChild,
    checked: false,
    childCommitIds: children,
  }
}

function byNewest(left: CleanupRevision, right: CleanupRevision): number {
  if (left.timestamp !== right.timestamp) {
    return left.timestamp < right.timestamp ? 1 : -1
  }
  return left.commitId.localeCompare(right.commitId)
}

function isValidKeep(commitId: string, revisions: readonly CleanupRevision[]): boolean {
  return revisions.every((revision) => revision.commitId === commitId || revision.canDrop)
}

function defaultKeep(revisions: readonly CleanupRevision[]): string {
  const valid = revisions.filter((revision) => isValidKeep(revision.commitId, revisions))
  const pool = valid.length > 0 ? valid : revisions
  const workingCopy = pool.find((revision) => revision.isWorkingCopy)
  if (workingCopy) {
    return workingCopy.commitId
  }
  return [...pool].sort(byNewest)[0]?.commitId ?? ''
}

export function classifyDivergent(commits: readonly DivergentCommit[]): CleanupDivergence[] {
  const divergent = commits.filter((commit) => commit.isDivergent)
  const changeIds = [...new Set(divergent.map((commit) => commit.changeId))].sort((a, b) =>
    a.localeCompare(b),
  )
  return changeIds.map((changeId) => {
    const members = divergent.filter((commit) => commit.changeId === changeId)
    const revisions = members.map((commit) => toRevision(commit, commits)).sort(byNewest)
    const keep = defaultKeep(revisions)
    return {
      changeId,
      changePrefix: members[0]?.changePrefix ?? changeId.slice(0, 8),
      revisions: revisions.map((revision) => ({
        ...revision,
        checked: revision.canDrop && revision.commitId !== keep,
      })),
    }
  })
}

function survivorTarget(revisions: readonly CleanupRevision[]): string | null {
  const workingCopy = revisions.find((revision) => revision.isWorkingCopy)
  if (workingCopy) {
    return workingCopy.commitId
  }
  return [...revisions].sort(byNewest)[0]?.commitId ?? null
}

function divergentSteps(group: CleanupDivergence, dropIds: ReadonlySet<string>): CleanupStep[] {
  const dropping = group.revisions.filter(
    (revision) => revision.canDrop && dropIds.has(revision.commitId),
  )
  if (dropping.length === 0) {
    return []
  }
  const droppingIds = new Set(dropping.map((revision) => revision.commitId))
  const onto = survivorTarget(
    group.revisions.filter((revision) => !droppingIds.has(revision.commitId)),
  )
  const rebases: CleanupStep[] = []
  if (onto) {
    for (const revision of dropping) {
      const move = revision.childCommitIds.filter((id) => id !== onto && !droppingIds.has(id))
      if (move.length > 0) {
        rebases.push({ kind: 'rebase', revset: move.join('|'), onto })
      }
    }
  }
  return [
    ...rebases,
    ...dropping.map((revision) => ({ kind: 'abandon' as const, commitId: revision.commitId })),
  ]
}

function deletedBookmarkSteps(
  snapshot: CleanupSnapshot,
  selection: CleanupSelection,
): CleanupStep[] {
  const selected = new Set(selection.deletedBookmarks)
  const pushNames = new Set(selection.deleteRemote)
  const steps: CleanupStep[] = []
  for (const bookmark of snapshot.deletedBookmarks) {
    if (!selected.has(bookmark.name)) {
      continue
    }
    if (bookmark.canDeleteRemote && pushNames.has(bookmark.name)) {
      steps.push({ kind: 'pushDeletedBookmark', name: bookmark.name })
    } else {
      steps.push({ kind: 'forgetBookmark', name: bookmark.name })
    }
  }
  return steps
}

export function cleanupSteps(
  snapshot: CleanupSnapshot,
  selection: CleanupSelection,
): CleanupStep[] {
  const bookmarkNames = new Set(selection.bookmarks)
  const workspaceNames = new Set(selection.workspaces)
  const dropIds = new Set(selection.divergent)
  const deleted = deletedBookmarkSteps(snapshot, selection)
  const forgets: CleanupStep[] = []
  for (const bookmark of snapshot.bookmarks) {
    if (bookmarkNames.has(bookmark.name)) {
      forgets.push({ kind: 'forgetBookmark', name: bookmark.name })
    }
  }
  const workspaceSteps: CleanupStep[] = []
  for (const workspace of snapshot.workspaces) {
    if (workspaceNames.has(workspace.name)) {
      workspaceSteps.push({ kind: 'forgetWorkspace', name: workspace.name })
    }
  }
  return [
    ...deleted.filter((step) => step.kind === 'pushDeletedBookmark'),
    ...forgets,
    ...deleted.filter((step) => step.kind === 'forgetBookmark'),
    ...snapshot.divergent.flatMap((group) => divergentSteps(group, dropIds)),
    ...workspaceSteps,
  ]
}
