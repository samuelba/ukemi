import { firstLine } from '../util/text'
import type { ParsedBookmark } from '../jj/parse'

const GIT_REMOTE = 'git'

export interface BookmarkGroupElement {
  kind: 'group'
  repoId: string
  remote: string | null
  label: string
  id: string
}

export interface BookmarkRowElement {
  kind: 'bookmark'
  repoId: string
  name: string
  remote: string | null
  commitId: string | null
  label: string
  description: string
  tooltipLines: string[]
  contextValue: string
  id: string
}

export function bookmarkGroups(
  rows: readonly ParsedBookmark[],
  repoId: string,
): BookmarkGroupElement[] {
  const visible = rows.filter((row) => row.remote !== GIT_REMOTE)
  const groups: BookmarkGroupElement[] = []
  if (visible.some((row) => row.remote === null)) {
    groups.push(groupElement(repoId, null, 'Local'))
  }
  const remotes = [
    ...new Set(visible.flatMap((row) => (row.remote === null ? [] : [row.remote]))),
  ].sort((left, right) => left.localeCompare(right))
  for (const remote of remotes) {
    groups.push(groupElement(repoId, remote, remote))
  }
  return groups
}

export function bookmarkRows(
  rows: readonly ParsedBookmark[],
  group: BookmarkGroupElement,
  trunkName: string | null,
  hasRemotes = true,
): BookmarkRowElement[] {
  return rows
    .filter((row) => row.remote === group.remote)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((row) => rowElement(row, rows, group.repoId, trunkName, hasRemotes))
}

export function isBookmarkTreeElement(arg: unknown): arg is BookmarkRowElement {
  if (typeof arg !== 'object' || arg === null) {
    return false
  }
  const value = arg as { kind?: unknown; repoId?: unknown; name?: unknown }
  return (
    value.kind === 'bookmark' && typeof value.repoId === 'string' && typeof value.name === 'string'
  )
}

function groupElement(repoId: string, remote: string | null, label: string): BookmarkGroupElement {
  return {
    kind: 'group',
    repoId,
    remote,
    label,
    id: `${repoId}\n${remote ?? 'local'}`,
  }
}

function rowElement(
  row: ParsedBookmark,
  rows: readonly ParsedBookmark[],
  repoId: string,
  trunkName: string | null,
  hasRemotes: boolean,
): BookmarkRowElement {
  const unsynced = row.remote === null && row.present && hasRemotes && !hasTrackedRemote(row, rows)
  const isTrunk = trunkName !== null && row.name === trunkName
  const label = rowLabel(row)
  return {
    kind: 'bookmark',
    repoId,
    name: row.name,
    remote: row.remote,
    commitId: row.commitId,
    label,
    description: rowDescription(row, unsynced),
    tooltipLines: tooltipLines(row, rows, label, unsynced, isTrunk),
    contextValue: contextValue(row, unsynced, isTrunk),
    id: `${repoId}\n${row.remote ?? 'local'}\n${row.name}`,
  }
}

function hasTrackedRemote(local: ParsedBookmark, rows: readonly ParsedBookmark[]): boolean {
  return rows.some(
    (row) =>
      row.name === local.name &&
      row.remote !== null &&
      row.remote !== GIT_REMOTE &&
      row.tracked &&
      row.commitId !== null &&
      row.commitId === local.commitId,
  )
}

function contextValue(row: ParsedBookmark, unsynced: boolean, isTrunk: boolean): string {
  const flags = ['bookmark', row.remote === null ? 'local' : 'remote']
  if (unsynced) {
    flags.push('unsynced')
  }
  if (isTrunk) {
    flags.push('trunk')
  }
  if (row.conflict) {
    flags.push('conflict')
  }
  if (row.present) {
    flags.push('present')
  } else {
    flags.push('deleted')
  }
  if (row.remote !== null && row.tracked) {
    flags.push('tracked')
  }
  return flags.join('+')
}

function rowDescription(row: ParsedBookmark, unsynced: boolean): string {
  const marks: string[] = []
  const line = firstLine(row.description)
  if (line.length > 0) {
    marks.push(line)
  }
  if (unsynced) {
    marks.push('*')
  }
  if (row.conflict) {
    marks.push('??')
  }
  return marks.join(' ')
}

function rowLabel(row: ParsedBookmark): string {
  const name = row.remote === null ? row.name : `${row.name}@${row.remote}`
  return row.present ? name : `(deleted) ${name}`
}

function bookmarkStatus(row: ParsedBookmark, unsynced: boolean): string {
  if (!row.present) {
    return 'deleted'
  }
  if (row.remote === null) {
    return unsynced ? 'unsynced' : 'synced'
  }
  return row.tracked ? 'tracked' : 'untracked'
}

function tooltipLines(
  row: ParsedBookmark,
  rows: readonly ParsedBookmark[],
  label: string,
  unsynced: boolean,
  isTrunk: boolean,
): string[] {
  const message = firstLine(row.description)
  const status = [
    isTrunk ? 'trunk' : '',
    bookmarkStatus(row, unsynced),
    row.conflict ? 'conflict' : '',
  ].filter((part) => part.length > 0)
  return [
    label,
    message.length > 0 ? message : '(no description)',
    row.commitId ?? 'No commit',
    status.join(', '),
    ...remoteDeletionLines(row, rows),
  ]
}

function remoteDeletionLines(row: ParsedBookmark, rows: readonly ParsedBookmark[]): string[] {
  if (row.remote !== null || row.present) {
    return []
  }
  const remotes = [
    ...new Set(
      rows.flatMap((other) =>
        other.name === row.name &&
        other.remote !== null &&
        other.remote !== GIT_REMOTE &&
        other.tracked
          ? [other.remote]
          : [],
      ),
    ),
  ].sort((left, right) => left.localeCompare(right))
  if (remotes.length === 0) {
    return []
  }
  return [`Push deletes ${remotes.map((remote) => `${row.name}@${remote}`).join(', ')}`]
}
