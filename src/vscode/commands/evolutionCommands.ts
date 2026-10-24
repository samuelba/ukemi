import * as vscode from 'vscode'
import { canRestoreVersion } from '../../../shared/evolution'
import { isEvolutionVersionNode } from '../../repo/evolutionItems'
import type { RepoModel } from '../../repo/repoModel'
import { errorMessage } from '../../util/logger'
import { openVersionDiff } from '../diff'
import { contextModel, type CommandEnv, type Handler } from './context'

export function evolutionCommands(env: CommandEnv): Record<string, Handler> {
  return {
    'ukemi.evolution.open': (arg) => showVersion(env, arg, 'previous'),
    'ukemi.evolution.compare': (arg) => showVersion(env, arg, 'current'),
    'ukemi.evolution.restore': (arg) => restoreVersion(env, arg),
  }
}

async function showVersion(
  env: CommandEnv,
  arg: unknown,
  mode: 'previous' | 'current',
): Promise<void> {
  if (!isEvolutionVersionNode(arg)) {
    return
  }
  if (mode === 'previous' && !arg.previousCommitId) {
    return
  }
  const model = contextModel(env, { repoId: arg.repoId })
  const commit = model?.commitFor(arg.commitId, arg.changeId)
  if (!model || !commit) {
    void vscode.window.showWarningMessage(
      'Ukemi: the change is no longer visible. Refresh and try again.',
    )
    return
  }
  const entries = await entriesFor(env, model, commit.commitId)
  const version = entries.find((entry) => entry.commitId === arg.versionCommitId)
  const otherId = mode === 'previous' ? arg.previousCommitId : entries[0]?.commitId
  const other = entries.find((entry) => entry.commitId === otherId)
  if (!version || !other || version.commitId === other.commitId) {
    void vscode.window.showWarningMessage('Ukemi: that version is no longer available.')
    return
  }
  const [from, to] = mode === 'previous' ? [other, version] : [version, other]
  await openVersionDiff(model, commit, from, to)
}

async function restoreVersion(env: CommandEnv, arg: unknown): Promise<void> {
  if (!isEvolutionVersionNode(arg)) {
    return
  }
  const model = contextModel(env, { repoId: arg.repoId })
  const commit = model?.commitFor(arg.commitId, arg.changeId)
  if (!model || !commit) {
    return
  }
  const entries = await entriesFor(env, model, commit.commitId)
  const index = entries.findIndex((entry) => entry.commitId === arg.versionCommitId)
  const version = entries[index]
  if (!version || commit.isImmutable || !canRestoreVersion(entries, index)) {
    return
  }
  const answer = await vscode.window.showWarningMessage(
    `Restore the files of version ${version.commitPrefix} into this change?`,
    { modal: true, detail: 'The description stays. You can undo this.' },
    'Restore',
  )
  if (answer === 'Restore') {
    await env.operations.run('Restore version', model, () =>
      model.repo.restoreVersion(version.commitId, commit.commitId),
    )
  }
}

async function entriesFor(env: CommandEnv, model: RepoModel, commitId: string) {
  try {
    return await model.repo.evolution(commitId)
  } catch (error: unknown) {
    env.logger.warn(`Evolution of ${commitId} failed: ${errorMessage(error)}`)
    return []
  }
}
