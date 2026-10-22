export interface Signature {
  name: string
  email: string
  timestamp: string
}

export interface LocalBookmark {
  name: string
  synced: boolean
  conflict: boolean
}

export interface RemoteBookmark {
  name: string
  remote: string
  tracked: boolean
}

export interface Commit {
  changeId: string
  changePrefix: string
  commitId: string
  commitPrefix: string
  parents: string[]
  description: string
  author: Signature
  committer: Signature
  localBookmarks: LocalBookmark[]
  remoteBookmarks: RemoteBookmark[]
  tags: string[]
  workingCopies: string[]
  changeOffset: number | null
  isWorkingCopy: boolean
  isEmpty: boolean
  hasConflict: boolean
  isImmutable: boolean
  isDivergent: boolean
  isHidden: boolean
  isMine: boolean
  isPushed: boolean
}

export type FileStatus = 'added' | 'modified' | 'removed' | 'renamed' | 'copied'

export interface ChangedFile {
  path: string
  sourcePath: string
  status: FileStatus
  isConflicted: boolean
}

export interface Workspace {
  name: string
  root: string | null
  commitId: string
}

export interface Operation {
  id: string
  description: string
  time: string
}

export interface EvolutionEntry {
  commitId: string
  commitPrefix: string
  parents: string[]
  description: string
  timestamp: string
  isEmpty: boolean
  operation: string
}

export interface Remote {
  name: string
  url: string
}

export type GraphFilter = 'recent' | 'mine' | 'myHistory' | 'stack'
export type HistoryDepth = '7d' | '14d' | '30d' | '1y' | 'all'

export const HISTORY_DEPTHS: readonly HistoryDepth[] = ['7d', '14d', '30d', '1y', 'all']
export const GRAPH_FILTERS: readonly GraphFilter[] = ['recent', 'mine', 'myHistory', 'stack']
export const DEPTHLESS_FILTERS: readonly GraphFilter[] = ['mine', 'stack']
