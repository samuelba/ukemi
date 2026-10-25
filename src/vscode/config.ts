import * as vscode from 'vscode'
import {
  GRAPH_FILTERS,
  HISTORY_DEPTHS,
  type GraphFilter,
  type HistoryDepth,
} from '../../shared/model'
import type { ChangedFilesView } from '../../shared/protocol'
import { DEFAULT_EXCLUDES } from '../repo/discovery'

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
  changedFilesView: ChangedFilesView
  snapshotOnRefresh: boolean
  addJjToTerminalPath: boolean
  gitlabHosts: string[]
  githubHosts: string[]
  autoFetchEnabled: boolean
  autoFetchInterval: string
}

export async function updateUkemiSetting<T>(key: string, value: T): Promise<void> {
  const config = vscode.workspace.getConfiguration('ukemi')
  const inspected = config.inspect<T>(key)
  const target =
    inspected?.workspaceFolderValue !== undefined
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : inspected?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global
  await config.update(key, value, target)
}

const CHANGED_FILES_VIEWS = ['list', 'tree'] as const satisfies readonly ChangedFilesView[]

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

export function readConfig(): UkemiConfig {
  const c = vscode.workspace.getConfiguration('ukemi')
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
    changedFilesView: oneOf(c.get<string>('changedFilesView', 'list'), CHANGED_FILES_VIEWS, 'list'),
    snapshotOnRefresh: c.get<boolean>('workspaces.snapshotOnRefresh', false),
    addJjToTerminalPath: c.get<boolean>('addJjToTerminalPath', true),
    gitlabHosts: c.get<string[]>('gitlab.hosts', []),
    githubHosts: c.get<string[]>('github.hosts', []),
    autoFetchEnabled: c.get<boolean>('autoFetch.enabled', false),
    autoFetchInterval: c.get<string>('autoFetch.interval', '10m'),
  }
}
