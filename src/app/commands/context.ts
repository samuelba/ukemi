import { z } from 'zod'
import type { ChangedFile, EvolutionEntry } from '../../../shared/model'
import type { CommitView, HostMessage } from '../../../shared/protocol'
import type { JjRunner } from '../../jj/runner'
import type { RepoModel } from '../../repo/repoModel'
import type { Logger } from '../../util/logger'
import type { AutoFetcher } from '../autoFetch'
import type { ChangeSelection } from '../changeSelection'
import type { ForgeService } from '../forgeService'
import type { FolderSource } from '../host'
import type { Operations } from '../operations'
import type { RepoRegistry } from '../registry'
import type { Settings } from '../settings'
import type { Ui } from '../ui'

// The graph as the commands see it, in the sidebar, an editor panel or a window.
export interface GraphSurface {
  readonly isVisible: boolean
  post(message: HostMessage): void
  showCommit(commitId: string): Promise<void>
}

// The places a host opens for the user: diffs, panels, windows and terminals.
export interface Workbench {
  openFileDiff(model: RepoModel, commit: CommitView, file: ChangedFile): Promise<void>
  openCommitDiff(model: RepoModel, commit: CommitView, files: ChangedFile[]): Promise<void>
  openVersionDiff(
    model: RepoModel,
    commit: CommitView,
    from: EvolutionEntry,
    to: EvolutionEntry,
  ): Promise<void>
  openFileAtRevision(model: RepoModel, commit: CommitView, path: string): Promise<void>
  openSplit(target: Target): Promise<void>
  openCleanup(model: RepoModel): void
  // Opens the settings. A key like `ukemi.jjPath` jumps to that setting.
  openSettings(key?: string): void
  // Opens a folder in a new window.
  openWindow(root: string): Promise<void>
  // Adds a folder to this window. Returns false when the host refused.
  addFolder(root: string, name: string): boolean
  openTerminal(cwd: string, name: string): void
  installJj(): Promise<void>
  openFolder(): Promise<void>
}

export interface CommandEnv {
  registry: RepoRegistry
  operations: Operations
  graphView: GraphSurface
  forge: ForgeService
  runner: JjRunner
  logger: Logger
  selection: ChangeSelection
  autoFetch: AutoFetcher
  ui: Ui
  settings: Settings
  folders: FolderSource
  workbench: Workbench
}

const contextSchema = z
  .object({
    repoId: z.string().optional(),
    commitId: z.string().optional(),
    path: z.string().optional(),
    bookmark: z.string().optional(),
    remote: z.string().optional(),
    number: z.number().optional(),
    url: z.string().optional(),
    workspace: z.string().optional(),
  })
  .passthrough()

export type ItemContext = z.infer<typeof contextSchema>

export function parseContext(arg: unknown): ItemContext {
  const result = contextSchema.safeParse(arg ?? {})
  return result.success ? result.data : {}
}

export function contextModel(env: CommandEnv, ctx: ItemContext): RepoModel | null {
  return (ctx.repoId ? env.registry.modelFor(ctx.repoId) : null) ?? env.registry.activeModel
}

export interface Target {
  model: RepoModel
  commit: CommitView
}

export function contextCommit(env: CommandEnv, arg: unknown): Target | null {
  const ctx = parseContext(arg)
  const model = contextModel(env, ctx)
  if (!model) {
    void env.ui.warn('Ukemi: no jj repository is active.')
    return null
  }
  const commit = ctx.commitId
    ? model.findCommit(ctx.commitId)
    : model.graph?.commits.find((c) => c.isWorkingCopy)
  if (!commit) {
    void env.ui.warn('Ukemi: the change is no longer visible. Refresh and try again.')
    return null
  }
  return { model, commit }
}

export function shortId(commit: { changeId: string; changePrefix: string }): string {
  return commit.changeId.slice(0, Math.max(8, commit.changePrefix.length))
}

export function commitTitle(commit: CommitView): string {
  return commit.description.split('\n')[0]?.trim() || '(no description)'
}

export type Handler = (...args: unknown[]) => unknown
