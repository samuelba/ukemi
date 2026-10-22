import type { GraphRow } from './graphLayout'
import type { ChangedFile, Commit, GraphFilter, HistoryDepth, Workspace } from './model'

export type RequestState = 'draft' | 'open' | 'reviewed' | 'approved' | 'merged' | 'closed'
export type CiState = 'pending' | 'success' | 'failure' | 'none'
export type ForgeKind = 'github' | 'gitlab'

export interface RequestBadge {
  number: number
  title: string
  url: string
  state: RequestState
  ci: CiState
  headBranch: string
  baseBranch: string
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

export interface ViewSettings {
  changeIdLength: number
  showFullPaths: boolean
}

export interface ViewState {
  status: ViewStatus
  repos: RepoSummary[]
  activeRepoId: string | null
  graph: GraphState | null
  busy: string | null
  error: string | null
  settings: ViewSettings
}

export type DropMode = 'source' | 'revision'

export type HostMessage =
  | { type: 'state'; state: ViewState }
  | { type: 'files'; repoId: string; commitId: string; files: ChangedFile[] }
  | { type: 'describe'; commitId: string; description: string }

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'selectRepo'; repoId: string }
  | { type: 'setFilter'; filter: GraphFilter }
  | { type: 'setDepth'; depth: HistoryDepth }
  | { type: 'loadFiles'; commitId: string }
  | { type: 'command'; command: string; context: Record<string, unknown> }
  | { type: 'describe'; commitId: string; message: string; startNew: boolean }
  | { type: 'openFile'; commitId: string; path: string; mode: 'diff' | 'file' }
  | { type: 'dropCommit'; sourceId: string; targetId: string; mode: DropMode }
  | { type: 'dropFile'; fromCommitId: string; path: string; targetId: string }
  | { type: 'dropBookmark'; name: string; targetId: string }
  | { type: 'doubleClickCommit'; commitId: string }
  | { type: 'dismissError' }
  | { type: 'initRepo'; root: string }
  | { type: 'installJj' }
  | { type: 'openFolder' }
