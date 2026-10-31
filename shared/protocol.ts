import type { FileIconTheme } from './fileIconTheme'
import type { GraphRow } from './graphLayout'
import type { ChangedFile, Commit, GraphFilter, HistoryDepth, Workspace } from './model'

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
  hasRemotes: boolean
  hasUnpushed: boolean
  canUndo: boolean
  canRedo: boolean
  currentBookmarks: string[]
  trunkName: string | null
  forge: ForgeState | null
}

export interface RepoSummary {
  id: string
  label: string
  kind: 'jj' | 'git'
  changedFiles: number
}

export type ViewStatus = 'loading' | 'ready' | 'no-folder' | 'no-repo' | 'no-jj' | 'error'

export type ChangedFilesView = 'list' | 'tree'

export interface ViewSettings {
  changeIdLength: number
  showFullPaths: boolean
  showLineStats: boolean
  showGitTags: boolean
  changedFilesView: ChangedFilesView
  ciOnlyMine: boolean
}

export interface AutoFetchState {
  enabled: boolean
  interval: string
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

export type HostMessage =
  | { type: 'state'; state: ViewState }
  | { type: 'reveal'; commitId: string }
  | { type: 'files'; repoId: string; commitId: string; files: ChangedFile[] }
  | { type: 'fileIcons'; theme: FileIconTheme | null }
  | { type: 'describe'; commitId: string; description: string }

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'selectRepo'; repoId: string }
  | { type: 'setFilter'; filter: GraphFilter }
  | { type: 'setDepth'; depth: HistoryDepth }
  | { type: 'loadFiles'; commitId: string }
  | { type: 'selectCommit'; commitId: string }
  | { type: 'command'; command: string; context: Record<string, unknown> }
  | { type: 'describe'; commitId: string; message: string; startNew: boolean }
  | { type: 'openFile'; commitId: string; path: string; mode: 'diff' | 'file' }
  | {
      type: 'dropCommit'
      sourceId: string
      targetId: string
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
