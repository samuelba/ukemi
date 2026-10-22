import * as vscode from 'vscode'
import type { HistoryDepth } from '../../shared/model'
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
  changeIdLength: number
  showFullPaths: boolean
  addJjToTerminalPath: boolean
  gitlabHosts: string[]
  githubHosts: string[]
}

const HISTORY_DEPTHS: readonly HistoryDepth[] = ['7d', '30d', '1y', 'all']

export function readConfig(): UkemiConfig {
  const c = vscode.workspace.getConfiguration('ukemi')
  const depth = c.get<string>('historyDepth', '7d')
  return {
    jjPath: c.get<string>('jjPath', ''),
    showSourceControl: c.get<SourceControlMode>('showSourceControl', 'auto'),
    showInPanel: c.get<boolean>('showInPanel', false),
    followActiveEditor: c.get<boolean>('followActiveEditor', true),
    repoScanDepth: c.get<number>('repoScanDepth', 4),
    repoScanExclude: c.get<string[]>('repoScanExclude', DEFAULT_EXCLUDES),
    historyDepth: HISTORY_DEPTHS.includes(depth as HistoryDepth) ? (depth as HistoryDepth) : '7d',
    changeIdLength: c.get<number>('changeIdLength', 4),
    showFullPaths: c.get<boolean>('showFullPaths', false),
    addJjToTerminalPath: c.get<boolean>('addJjToTerminalPath', true),
    gitlabHosts: c.get<string[]>('gitlab.hosts', []),
    githubHosts: c.get<string[]>('github.hosts', []),
  }
}
