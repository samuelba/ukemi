import { isFileHistoryEntry, type FileHistoryEntry } from '../../../shared/fileHistory'
import type { ChangedFile } from '../../../shared/model'
import type { CommitView } from '../../../shared/protocol'
import type { RepoModel } from '../../repo/repoModel'
import { errorMessage } from '../../util/logger'
import { contextModel, parseContext, type CommandEnv, type Handler } from './context'

export function fileHistoryCommands(env: CommandEnv): Record<string, Handler> {
  return {
    'ukemi.file.history': async (arg) => {
      const ctx = parseContext(arg)
      const model = contextModel(env, ctx)
      if (!model || !ctx.path) {
        void env.ui.warn('Ukemi: pick a file in a jj repository to see its history.')
        return
      }
      await env.workbench.showFileHistory(model, ctx.path)
    },
    'ukemi.fileHistory.openDiff': (arg) => withEntry(env, arg, openHistoryDiff),
    'ukemi.fileHistory.openFile': (arg) =>
      withEntry(env, arg, (env, model, commit, entry) =>
        env.workbench.openFileAtRevision(model, commit, entry.path),
      ),
    'ukemi.fileHistory.reveal': (arg) => withEntry(env, arg, revealInGraph),
    'ukemi.fileHistory.copyChangeId': async (arg) => {
      if (isFileHistoryEntry(arg)) {
        await env.ui.copy(arg.changeId)
      }
    },
  }
}

type EntryAction = (
  env: CommandEnv,
  model: RepoModel,
  commit: CommitView,
  entry: FileHistoryEntry,
) => Promise<void>

// History rows name changes the graph may not show, so the change is loaded by its commit id.
export async function withEntry(env: CommandEnv, arg: unknown, action: EntryAction) {
  if (!isFileHistoryEntry(arg)) {
    return
  }
  const model = contextModel(env, { repoId: arg.repoId })
  if (!model) {
    return
  }
  let commit: CommitView | null
  try {
    commit = await model.loadCommit(arg.commitId)
  } catch (error: unknown) {
    env.logger.warn(`loading ${arg.commitId} failed: ${errorMessage(error)}`)
    commit = null
  }
  if (!commit) {
    void env.ui.warn('Ukemi: that change is no longer in the repository. Refresh the history.')
    return
  }
  await action(env, model, commit, arg)
}

// The file as the change touched it, with its status there.
export async function historyFile(
  model: RepoModel,
  commit: CommitView,
  path: string,
): Promise<ChangedFile> {
  const files = await model.filesFor(commit.commitId)
  return (
    files.find((f) => f.path === path) ?? {
      path,
      sourcePath: path,
      status: 'modified',
      isConflicted: false,
    }
  )
}

export async function openHistoryDiff(
  env: CommandEnv,
  model: RepoModel,
  commit: CommitView,
  entry: FileHistoryEntry,
): Promise<void> {
  await env.workbench.openFileDiff(model, commit, await historyFile(model, commit, entry.path))
}

export async function revealInGraph(
  env: CommandEnv,
  model: RepoModel,
  commit: CommitView,
): Promise<void> {
  if (!model.findCommit(commit.commitId)) {
    void env.ui.info(
      'Ukemi: the graph does not show this change. Pick another filter or a revset that includes it.',
    )
    return
  }
  await env.graphView.showCommit(commit.commitId)
}
