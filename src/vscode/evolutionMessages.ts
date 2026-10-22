import * as vscode from 'vscode'
import { canRestoreVersion } from '../../shared/evolution'
import type { EvolutionEntry } from '../../shared/model'
import type { WebviewMessage } from '../../shared/protocol'
import type { RepoModel } from '../repo/repoModel'
import { errorMessage } from '../util/logger'
import type { CommandEnv } from './commands/context'
import { openVersionDiff } from './diff'

type EvolutionMessage = Extract<
  WebviewMessage,
  { type: 'loadEvolution' | 'openVersionDiff' | 'restoreVersion' }
>

async function entriesFor(env: CommandEnv, model: RepoModel, commitId: string) {
  try {
    return await model.repo.evolution(commitId)
  } catch (error) {
    env.logger.warn(`Evolution of ${commitId} failed: ${errorMessage(error)}`)
    return []
  }
}

async function restore(env: CommandEnv, model: RepoModel, commitId: string, fromId: string) {
  const commit = model.findCommit(commitId)
  const entries = await entriesFor(env, model, commitId)
  const index = entries.findIndex((entry) => entry.commitId === fromId)
  if (!commit || commit.isImmutable || !canRestoreVersion(entries, index)) {
    return
  }
  const version = entries[index] as EvolutionEntry
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

export async function handleEvolutionMessage(
  env: CommandEnv,
  model: RepoModel,
  message: EvolutionMessage,
): Promise<void> {
  switch (message.type) {
    case 'loadEvolution': {
      const entries = await entriesFor(env, model, message.commitId)
      env.graphView.post({
        type: 'evolution',
        repoId: model.root,
        commitId: message.commitId,
        entries,
      })
      return
    }
    case 'openVersionDiff': {
      const commit = model.findCommit(message.commitId)
      const entries = await entriesFor(env, model, message.commitId)
      const from = entries.find((entry) => entry.commitId === message.fromCommitId)
      const to = entries.find((entry) => entry.commitId === message.toCommitId)
      if (commit && from && to) {
        await openVersionDiff(model, commit, from, to)
      }
      return
    }
    case 'restoreVersion':
      await restore(env, model, message.commitId, message.fromCommitId)
      return
  }
}
