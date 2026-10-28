import type { ChangedFile } from './model'

export const UNDESCRIBED_LIMIT = 200

export type BookmarkCleanupReason = 'deleted-remote' | 'merged' | 'conflict'

export interface CleanupBookmark {
  name: string
  reason: BookmarkCleanupReason
  detail: string
  description: string
  checked: boolean
  hasGitRemote: boolean
  abandonCommitIds: readonly string[]
}

export interface CleanupDeletedBookmark {
  name: string
  remotes: string[]
  detail: string
  checked: boolean
  canDeleteRemote: boolean
}

export interface CleanupWorkspace {
  name: string
  detail: string
  checked: boolean
  root: string | null
  canDeleteFiles: boolean
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

export interface CleanupUndescribed {
  commitId: string
  changePrefix: string
  commitPrefix: string
  timestamp: string
  isEmpty: boolean
  isImmutable: boolean
  canAbandon: boolean
}

export interface CleanupSnapshot {
  bookmarks: CleanupBookmark[]
  deletedBookmarks: CleanupDeletedBookmark[]
  workspaces: CleanupWorkspace[]
  divergent: CleanupDivergence[]
  undescribed: CleanupUndescribed[]
  undescribedTruncated: boolean
}

export interface CleanupSelection {
  bookmarks: readonly string[]
  abandonBookmarkCommits: readonly string[]
  deletedBookmarks: readonly string[]
  deleteRemote: readonly string[]
  workspaces: readonly string[]
  deleteWorkspaceFiles: readonly string[]
  divergent: readonly string[]
  undescribed: readonly string[]
}

export type CleanupHostMessage =
  | { type: 'load'; snapshot: CleanupSnapshot }
  | { type: 'files'; commitId: string; files: ChangedFile[] }

export type CleanupWebviewMessage =
  | { type: 'ready' }
  | { type: 'apply'; selection: CleanupSelection }
  | { type: 'cancel' }
  | { type: 'loadFiles'; commitId: string }
  | { type: 'openFile'; commitId: string; path: string }
  | { type: 'openDiff'; commitId: string }
