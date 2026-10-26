export type BookmarkCleanupReason = 'deleted-remote' | 'merged' | 'conflict'

export interface CleanupBookmark {
  name: string
  reason: BookmarkCleanupReason
  detail: string
  description: string
  checked: boolean
}

export interface CleanupWorkspace {
  name: string
  detail: string
  checked: boolean
}

export interface CleanupRevision {
  commitId: string
  commitPrefix: string
  description: string
  timestamp: string
  isWorkingCopy: boolean
  canDrop: boolean
  checked: boolean
  childCommitIds: string[]
}

export interface CleanupDivergence {
  changeId: string
  changePrefix: string
  revisions: CleanupRevision[]
}

export interface CleanupSnapshot {
  bookmarks: CleanupBookmark[]
  workspaces: CleanupWorkspace[]
  divergent: CleanupDivergence[]
}

export interface CleanupSelection {
  bookmarks: readonly string[]
  workspaces: readonly string[]
  divergent: readonly string[]
}

export type CleanupHostMessage = { type: 'load'; snapshot: CleanupSnapshot }

export type CleanupWebviewMessage =
  { type: 'ready' } | { type: 'apply'; selection: CleanupSelection } | { type: 'cancel' }
