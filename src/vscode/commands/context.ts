import * as vscode from 'vscode'
import { z } from 'zod'
import type { CommitView } from '../../../shared/protocol'
import type { JjRunner } from '../../jj/runner'
import type { RepoModel } from '../../repo/repoModel'
import type { Logger } from '../../util/logger'
import type { AutoFetcher } from '../autoFetch'
import type { ChangeSelection } from '../changeSelection'
import type { ForgeService } from '../forgeService'
import type { GraphView } from '../graphView'
import type { Operations } from '../operations'
import type { RepoRegistry } from '../registry'

export interface CommandEnv {
  registry: RepoRegistry
  operations: Operations
  graphView: GraphView
  forge: ForgeService
  runner: JjRunner
  logger: Logger
  extensionId: string
  extensionUri: vscode.Uri
  storageUri: vscode.Uri
  selection: ChangeSelection
  autoFetch: AutoFetcher
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
    void vscode.window.showWarningMessage('Ukemi: no jj repository is active.')
    return null
  }
  const commit = ctx.commitId
    ? model.findCommit(ctx.commitId)
    : model.graph?.commits.find((c) => c.isWorkingCopy)
  if (!commit) {
    void vscode.window.showWarningMessage(
      'Ukemi: the change is no longer visible. Refresh and try again.',
    )
    return null
  }
  return { model, commit }
}

export function shortId(commit: CommitView): string {
  return commit.changeId.slice(0, Math.max(8, commit.changePrefix.length))
}

export function commitTitle(commit: CommitView): string {
  return commit.description.split('\n')[0]?.trim() || '(no description)'
}

export async function confirm(message: string, action: string, detail?: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(message, { modal: true, detail }, action)
  return choice === action
}

export type Handler = (arg?: unknown) => unknown

export function registerAll(
  context: vscode.ExtensionContext,
  handlers: Record<string, Handler>,
): void {
  for (const [id, handler] of Object.entries(handlers)) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler))
  }
}
