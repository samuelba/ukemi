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

// How a local bookmark stands against one remote. Ahead counts commits to push, behind
// counts commits to pull. Both are 0 for an untracked remote.
export interface BookmarkTracking {
  name: string
  remote: string
  tracked: boolean
  ahead: number
  behind: number
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
}

export type FileStatus = 'added' | 'modified' | 'removed' | 'renamed' | 'copied'

export const FILE_STATUS_LETTER: Readonly<Record<FileStatus, string>> = {
  added: 'A',
  modified: 'M',
  removed: 'D',
  renamed: 'R',
  copied: 'C',
}

export interface ChangedFile {
  path: string
  sourcePath: string
  status: FileStatus
  isConflicted: boolean
  linesAdded?: number
  linesRemoved?: number
}

export interface Workspace {
  name: string
  root: string | null
  commitId: string
  changeId: string
  description: string
  isEmpty: boolean
  changedFiles: number
}

// The change that last touched a line of a file. Lines count from 1.
export interface AnnotatedLine {
  commitId: string
  changeId: string
  line: number
}

export interface Operation {
  id: string
  description: string
  user: string
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

// `jjLog` shows the `revsets.log` of the user's jj config, the revset `jj log` shows.
export type GraphFilter = 'recent' | 'mine' | 'myHistory' | 'stack' | 'working' | 'jjLog'
export type HistoryDepth = '7d' | '14d' | '30d' | '1y' | 'all'

export const HISTORY_DEPTHS: readonly HistoryDepth[] = ['7d', '14d', '30d', '1y', 'all']
export const GRAPH_FILTERS: readonly GraphFilter[] = [
  'recent',
  'mine',
  'myHistory',
  'stack',
  'working',
  'jjLog',
]
export const DEPTHLESS_FILTERS: readonly GraphFilter[] = ['mine', 'stack', 'working', 'jjLog']

// A revset the user saved under a name, from the `savedRevsets` setting.
export interface SavedRevset {
  label: string
  revset: string
}
