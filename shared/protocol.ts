import type { FileIconTheme } from './fileIconTheme'
import type { GraphEdgeInput, GraphRow } from './graphLayout'
import type {
  BookmarkTracking,
  ChangedFile,
  Commit,
  GraphFilter,
  HistoryDepth,
  Workspace,
} from './model'

export type RequestState = 'draft' | 'open' | 'reviewed' | 'approved' | 'merged' | 'closed'
export type CiState = 'pending' | 'success' | 'failure' | 'manual' | 'skipped' | 'none'
export type ForgeKind = 'github' | 'gitlab'

export interface CiCheck {
  name: string
  stage?: string
  state: CiState
  url: string
}

export interface StackInfo {
  position: number
  size: number
}

export interface RequestBadge {
  number: number
  title: string
  url: string
  state: RequestState
  ci: CiState
  isMine: boolean
  pipelineUrl?: string
  checks: CiCheck[]
  headBranch: string
  baseBranch: string
  stack?: StackInfo
}

export interface CommitView extends Commit {
  row: GraphRow
  // The edges the row draws, elided ones included. A drop preview moves them around.
  edges: GraphEdgeInput[]
  isTrunk: boolean
  requests: RequestBadge[]
}

export interface ForgeState {
  kind: ForgeKind
  host: string
  isSignedIn: boolean
}

export interface GraphState {
  repoId: string
  commits: CommitView[]
  workingCopyFiles: ChangedFile[]
  workspaces: Workspace[]
  filter: GraphFilter
  depth: HistoryDepth
  // A revset the user typed. It replaces the filter while set.
  revset: string | null
  // The revset matches more commits than the graph loaded. Scrolling to the end loads more.
  isTruncated: boolean
  hasRemotes: boolean
  hasUnpushed: boolean
  canUndo: boolean
  canRedo: boolean
  currentBookmarks: string[]
  // The remote refs of the bookmarks on @ and of the current bookmarks.
  tracking: BookmarkTracking[]
  operationId: string | null
  trunkName: string | null
  forge: ForgeState | null
}

export interface RepoSummary {
  id: string
  label: string
  kind: 'jj' | 'git'
  changedFiles: number
  // Only in the app, where a tab can have a custom name: the folder name it replaces.
  folderLabel?: string
  isPinned?: boolean
}

export type ViewStatus = 'loading' | 'ready' | 'no-folder' | 'no-repo' | 'no-jj' | 'error'

export type ChangedFilesView = 'list' | 'tree'

export interface ViewSettings {
  changeIdLength: number
  showFullPaths: boolean
  showLineStats: boolean
  showGitTags: boolean
  // A dropped change shows the resulting graph first, with a button that applies it.
  previewDrops: boolean
  changedFilesView: ChangedFilesView
  ciOnlyMine: boolean
}

export interface AutoFetchState {
  enabled: boolean
  interval: string
  isRunning: boolean
  // When the active repository last fetched in the background, in epoch ms.
  lastFetch: number | null
}

export interface ViewState {
  status: ViewStatus
  repos: RepoSummary[]
  activeRepoId: string | null
  graph: GraphState | null
  busy: string | null
  error: string | null
  settings: ViewSettings
  autoFetch: AutoFetchState
}

export type DropMode = 'source' | 'revision'
export type DropAction = 'rebase' | 'duplicate'
export type FileDropAction = 'copy' | 'move'

// A tool that can suggest a change description, like Claude Code or GitHub Copilot.
export interface SuggesterView {
  id: string
  label: string
}

export type HostMessage =
  | { type: 'state'; state: ViewState }
  | { type: 'reveal'; commitId: string }
  | { type: 'files'; repoId: string; commitId: string; files: ChangedFile[] }
  | { type: 'fileIcons'; theme: FileIconTheme | null }
  | { type: 'describe'; commitId: string; changeId: string; description: string }
  | { type: 'suggesters'; suggesters: SuggesterView[] }
  | { type: 'descriptionSuggestion'; requestId: string; text?: string; error?: string }
  | { type: 'revsetResult'; revset: string; error: string | null }
  | { type: 'revsetHistory'; repoId: string; history: string[] }

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'selectRepo'; repoId: string }
  | { type: 'setFilter'; filter: GraphFilter }
  | { type: 'setDepth'; depth: HistoryDepth }
  | { type: 'setRevset'; revset: string }
  | { type: 'loadMore' }
  | { type: 'listRevsets' }
  | { type: 'loadFiles'; commitId: string }
  | { type: 'selectCommit'; commitId: string }
  | { type: 'command'; command: string; context: Record<string, unknown> }
  | { type: 'describe'; commitId: string; changeId: string; message: string; startNew: boolean }
  | { type: 'listSuggesters' }
  | { type: 'suggestDescription'; requestId: string; commitId: string; suggester: string }
  | { type: 'cancelSuggestion'; requestId: string }
  | { type: 'openFile'; commitId: string; path: string; mode: 'diff' | 'file' }
  | {
      type: 'dropCommit'
      sourceId: string
      targetId: string
      mode: DropMode
      action: DropAction
    }
  // Insert a change between two changes: after the lower one, before the upper one.
  | {
      type: 'insertCommit'
      sourceId: string
      afterId: string
      beforeId: string
      mode: DropMode
      action: DropAction
    }
  | {
      type: 'dropFile'
      fromCommitId: string
      path: string
      targetId: string
      action: FileDropAction
    }
  | { type: 'dropBookmark'; name: string; targetId: string }
  | { type: 'dismissError' }
  | { type: 'initRepo'; root: string }
  | { type: 'installJj' }
  | { type: 'openFolder' }
  | { type: 'openUrl'; url: string }
