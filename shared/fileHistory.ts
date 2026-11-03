import type { DiffDocument } from './desktopProtocol'

// A change in the history of one file, as the history views list it.
export interface FileHistoryEntry {
  kind: 'fileHistory'
  repoId: string
  path: string
  commitId: string
  changeId: string
  // The shortest unique prefix of the change id, with at least the configured length.
  shortChangeId: string
  // The git commit hash, shortened like the change id but to at least 8 characters.
  shortCommitId: string
  summary: string
  author: string
  // The current user authored the change, so views can say "You".
  isMine: boolean
  time: string
  isWorkingCopy: boolean
}

// Lines start..start+count-1 (from 1) last changed in the same change.
export interface BlameRun {
  start: number
  count: number
  commitId: string
}

export interface FileBlame {
  // The revision the lines were annotated at, by commit id.
  commitId: string
  text: string
  runs: BlameRun[]
  // The changes the runs name, by commit id.
  changes: Record<string, FileHistoryEntry>
}

export function authorLabel(entry: Pick<FileHistoryEntry, 'author' | 'isMine'>): string {
  return entry.isMine ? 'You' : entry.author
}

export type FileHistoryHostMessage =
  | { type: 'load'; path: string; entries: FileHistoryEntry[] }
  | { type: 'blame'; blame: FileBlame }
  // The file's diff in the selected change, or why it could not be shown.
  | { type: 'diff'; commitId: string; document: DiffDocument }
  | { type: 'diffError'; commitId: string; message: string }
  | { type: 'error'; message: string }

export type FileHistoryWebviewMessage =
  | { type: 'ready' }
  | { type: 'select'; commitId: string }
  | { type: 'openFile'; commitId: string }
  | { type: 'reveal'; commitId: string }
  | { type: 'loadBlame' }

export function isFileHistoryEntry(arg: unknown): arg is FileHistoryEntry {
  if (typeof arg !== 'object' || arg === null) {
    return false
  }
  const value = arg as { kind?: unknown; repoId?: unknown; path?: unknown; commitId?: unknown }
  return (
    value.kind === 'fileHistory' &&
    typeof value.repoId === 'string' &&
    typeof value.path === 'string' &&
    typeof value.commitId === 'string'
  )
}
