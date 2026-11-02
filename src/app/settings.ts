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
import { isRepositoryKey } from '../../shared/settingsScope'
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
  suggestTools: string[]
  suggestModels: Record<string, string>
  suggestInstructions: string
  suggestMaxDiffBytes: number
}

// Reads one `ukemi.*` setting by its key without the prefix.
export interface SettingsSource {
  get<T>(key: string, fallback: T): T
}

export interface SettingsChange {
  // Takes a key without the `ukemi.` prefix, like `autoFetch.enabled`. Without a root it tells
  // whether the key changed anywhere. With one, whether the value that repository sees changed.
  affects(key: string, root?: string): boolean
}

// `default` keeps the scope the user set the value in. `user` always writes the user value.
// `{ root }` writes the override of one repository; see shared/settingsScope.ts.
export type SettingScope = 'default' | 'user' | { root: string }

export interface SettingValues {
  // What all repositories get, before any override.
  globalValue: unknown
  repoValue: unknown
}

export interface Settings {
  // The settings of one repository: the global values with its overrides on top.
  read(root?: string): UkemiConfig
  // The values the user set for a key, without defaults.
  inspect(key: string, root: string): SettingValues
  update(key: string, value: unknown, scope?: SettingScope): Promise<void>
  readonly onDidChange: Event<SettingsChange>
}

// Toggles in the toolbar change the value the repository uses: its override when it has one,
// and the global value otherwise.
export function updateWhereItLives(
  settings: Settings,
  key: string,
  value: unknown,
  root: string | null,
): Promise<void> {
  const isOverridden =
    root !== null && isRepositoryKey(key) && settings.inspect(key, root).repoValue !== undefined
  return settings.update(key, value, isOverridden && root !== null ? { root } : 'default')
}

const CHANGED_FILES_VIEWS = ['list', 'tree'] as const satisfies readonly ChangedFilesView[]

// settings.json is edited by hand, so a value can have the wrong type.
function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

const SUGGEST_TOOLS = ['claude', 'copilot', 'cursor', 'vscode-lm']

function stringList(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : fallback
}

function stringMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
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
    statusInterval: text(c.get<unknown>('forge.statusInterval', '60s'), '60s'),
    autoFetchEnabled: c.get<boolean>('autoFetch.enabled', false),
    autoFetchInterval: text(c.get<unknown>('autoFetch.interval', '10m'), '10m'),
    nativeStacks: c.get<boolean>('forge.nativeStacks', true),
    suggestTools: stringList(c.get<unknown>('describeSuggest.tools', SUGGEST_TOOLS), SUGGEST_TOOLS),
    suggestModels: stringMap(c.get<unknown>('describeSuggest.models', {})),
    suggestInstructions: text(c.get<unknown>('describeSuggest.instructions', ''), ''),
    suggestMaxDiffBytes: clamp(
      c.get<unknown>('describeSuggest.maxDiffBytes', 40_000),
      2_000,
      100_000,
      40_000,
    ),
  }
}

// Hosts that the user logged in to with `gh` count as GitHub hosts. That file is user-level, not workspace-level.
export function readHostLists(settings: Settings): HostLists {
  const config = settings.read()
  return { gitlabHosts: config.gitlabHosts, githubHosts: [...config.githubHosts, ...ghHosts()] }
}
