import type { FileIconTheme } from './fileIconTheme'
import type { GraphEdgeInput, GraphRow } from './graphLayout'
import type {
  BookmarkTracking,
  ChangedFile,
  Commit,
  GraphFilter,
  HistoryDepth,
  SavedRevset,
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
  // ISO 8601. Unset for a job that has not started or has not finished.
  startedAt?: string
  finishedAt?: string
}

export interface StackInfo {
  position: number
  size: number
}

// The CI of one commit: its overall state, its pipeline and its jobs.
export interface CiSummary {
  ci: CiState
  pipelineUrl?: string
  // ISO 8601. The finish is unset while the pipeline still runs.
  pipelineStartedAt?: string
  pipelineFinishedAt?: string
  checks: CiCheck[]
}

export interface CommitCi extends CiSummary {
  commitId: string
}

export interface RequestBadge extends CiSummary {
  number: number
  title: string
  url: string
  state: RequestState
  isMine: boolean
  headBranch: string
  baseBranch: string
  stack?: StackInfo
}

export interface CommitView extends Commit {
  row: GraphRow
  // The edges the row draws, elided ones included. A drop preview moves them around.
  edges: GraphEdgeInput[]
  isTrunk: boolean
  // The newest change of a stack that is not based on the current trunk.
  isBehindTrunk: boolean
  requests: RequestBadge[]
}

export interface ForgeState {
  kind: ForgeKind
  host: string
  isSignedIn: boolean
  // Why the latest refresh failed; the requests shown are from an earlier one.
  refreshError?: string
  // The CI of the trunk commit, when `ukemi.forge.trunkCi` is on and the forge knows the commit.
  trunkCi?: CommitCi
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
  // With the jj log filter: the `revsets.log` it shows, or absent when jj could not tell.
  logRevset?: string
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
  // The revsets the filter menu lists by name, from the `savedRevsets` setting.
  savedRevsets: SavedRevset[]
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
  | { type: 'filesFailed'; repoId: string; commitId: string; error: string }
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
  // Asks for a name and adds the revset to the `savedRevsets` setting.
  | { type: 'saveRevset'; revset: string }
  | { type: 'editSavedRevsets' }
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
