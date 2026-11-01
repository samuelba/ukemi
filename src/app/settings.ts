import {
  GRAPH_FILTERS,
  HISTORY_DEPTHS,
  type GraphFilter,
  type HistoryDepth,
} from '../../shared/model'
import type { ChangedFilesView } from '../../shared/protocol'
import type { HostLists } from '../forge/detect'
import { ghHosts } from '../forge/ghConfig'
import { clampRequestLimit } from '../forge/requestLimit'
import { DEFAULT_EXCLUDES } from '../repo/discovery'
import type { Event } from './events'

export type SourceControlMode = 'auto' | 'always' | 'never'

export interface UkemiConfig {
  jjPath: string
  showSourceControl: SourceControlMode
  showInPanel: boolean
  followActiveEditor: boolean
  repoScanDepth: number
  repoScanExclude: string[]
  historyDepth: HistoryDepth
  defaultFilter: GraphFilter
  changeIdLength: number
  showFullPaths: boolean
  showLineStats: boolean
  showGitTags: boolean
  changedFilesView: ChangedFilesView
  snapshotOnRefresh: boolean
  addJjToTerminalPath: boolean
  gitlabHosts: string[]
  githubHosts: string[]
  gitlabOAuthApplications: Record<string, string>
  ciOnlyMine: boolean
  requestLimit: number
  statusInterval: string
  autoFetchEnabled: boolean
  autoFetchInterval: string
  nativeStacks: boolean
}

// Reads one `ukemi.*` setting by its key without the prefix.
export interface SettingsSource {
  get<T>(key: string, fallback: T): T
}

export interface SettingsChange {
  // Takes a key without the `ukemi.` prefix, like `autoFetch.enabled`.
  affects(key: string): boolean
}

export type SettingScope = 'default' | 'user'

export interface Settings {
  read(): UkemiConfig
  // `default` keeps the scope the user set the value in. `user` always writes the user value.
  update(key: string, value: unknown, scope?: SettingScope): Promise<void>
  readonly onDidChange: Event<SettingsChange>
}

const CHANGED_FILES_VIEWS = ['list', 'tree'] as const satisfies readonly ChangedFilesView[]

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

export function readSettings(c: SettingsSource): UkemiConfig {
  return {
    jjPath: c.get<string>('jjPath', ''),
    showSourceControl: c.get<SourceControlMode>('showSourceControl', 'auto'),
    showInPanel: c.get<boolean>('showInPanel', false),
    followActiveEditor: c.get<boolean>('followActiveEditor', true),
    repoScanDepth: c.get<number>('repoScanDepth', 4),
    repoScanExclude: c.get<string[]>('repoScanExclude', DEFAULT_EXCLUDES),
    historyDepth: oneOf(c.get<string>('historyDepth', '7d'), HISTORY_DEPTHS, '7d'),
    defaultFilter: oneOf(c.get<string>('defaultFilter', 'recent'), GRAPH_FILTERS, 'recent'),
    changeIdLength: c.get<number>('changeIdLength', 4),
    showFullPaths: c.get<boolean>('showFullPaths', false),
    showLineStats: c.get<boolean>('showLineStats', false),
    showGitTags: c.get<boolean>('showGitTags', true),
    changedFilesView: oneOf(c.get<string>('changedFilesView', 'list'), CHANGED_FILES_VIEWS, 'list'),
    snapshotOnRefresh: c.get<boolean>('workspaces.snapshotOnRefresh', false),
    addJjToTerminalPath: c.get<boolean>('addJjToTerminalPath', true),
    gitlabHosts: c.get<string[]>('gitlab.hosts', []),
    githubHosts: c.get<string[]>('github.hosts', []),
    gitlabOAuthApplications: c.get<Record<string, string>>('gitlab.oauthApplications', {}),
    ciOnlyMine: c.get<boolean>('forge.ciOnlyMine', true),
    requestLimit: clampRequestLimit(c.get<number>('forge.requestLimit', 50)),
    statusInterval: c.get<string>('forge.statusInterval', '60s'),
    autoFetchEnabled: c.get<boolean>('autoFetch.enabled', false),
    autoFetchInterval: c.get<string>('autoFetch.interval', '10m'),
    nativeStacks: c.get<boolean>('forge.nativeStacks', true),
  }
}

// Hosts that the user logged in to with `gh` count as GitHub hosts. That file is user-level, not workspace-level.
export function readHostLists(settings: Settings): HostLists {
  const config = settings.read()
  return { gitlabHosts: config.gitlabHosts, githubHosts: [...config.githubHosts, ...ghHosts()] }
}
