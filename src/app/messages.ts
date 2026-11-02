import type { WebviewMessage } from '../../shared/protocol'
import { isAllowedForgeUrl } from '../forge/hostName'
import type { RepoModel } from '../repo/repoModel'
import type { CommandEnv } from './commands/context'
import { SuggestionCancelled } from './describeSuggest/suggesters'
import { initRepo } from './commands/globalCommands'

const ALLOWED_COMMAND = /^ukemi\./

// Runs a registered Ukemi command with the context of the item the user picked it on.
export type CommandDispatcher = (command: string, context: Record<string, unknown>) => Promise<void>

export function createMessageHandler(env: CommandEnv, dispatch: CommandDispatcher) {
  return async (message: WebviewMessage): Promise<void> => {
    const model = env.registry.activeModel
    switch (message.type) {
      case 'selectRepo':
        await env.registry.setActive(message.repoId)
        return
      case 'command':
        if (ALLOWED_COMMAND.test(message.command)) {
          await dispatch(message.command, message.context)
        }
        return
      case 'dismissError':
        env.operations.dismissError()
        return
      case 'initRepo':
        await initRepo(env, message.root)
        return
      case 'installJj':
        await env.workbench.installJj()
        return
      case 'openFolder':
        await env.workbench.openFolder()
        return
      case 'listSuggesters':
        env.graphView.post({ type: 'suggesters', suggesters: await env.suggestions.list() })
        return
      case 'cancelSuggestion':
        env.suggestions.cancel(message.requestId)
        return
    }
    if (!model) {
      return
    }
    const graph = model.graph
    switch (message.type) {
      case 'setFilter':
      case 'setDepth': {
        const view = {
          filter: message.type === 'setFilter' ? message.filter : (graph?.filter ?? 'recent'),
          depth: message.type === 'setDepth' ? message.depth : (graph?.depth ?? '7d'),
        }
        await env.operations.track('Loading', () => model.setView(view.filter, view.depth))
        await env.registry.rememberView(model.root, view)
        return
      }
      case 'loadFiles': {
        const files = await model.filesFor(message.commitId)
        env.graphView.post({ type: 'files', repoId: model.root, commitId: message.commitId, files })
        return
      }
      case 'selectCommit': {
        const commit = model.findCommit(message.commitId)
        if (commit) {
          env.selection.select({
            repoId: model.root,
            commitId: commit.commitId,
            changeId: commit.changeId,
          })
        }
        return
      }
      case 'describe': {
        const commit = model.findCommit(message.commitId)
        if (!commit) {
          return
        }
        await env.operations.run('Describe', model, async () => {
          await model.repo.describe(message.commitId, message.message)
          if (message.startNew) {
            await model.repo.newChange(['@'])
          }
        })
        return
      }
      case 'suggestDescription':
        await suggestDescription(env, model, message)
        return
      case 'openFile': {
        const commit = model.findCommit(message.commitId)
        if (!commit) {
          return
        }
        const files = commit.isWorkingCopy
          ? (graph?.workingCopyFiles ?? [])
          : await model.filesFor(commit.commitId)
        const file = files.find((f) => f.path === message.path)
        if (file?.isConflicted && message.mode === 'file') {
          await env.workbench.openEditor(model, commit, file.path)
        } else if (message.mode === 'file' || !file) {
          await env.workbench.openFileAtRevision(model, commit, message.path)
        } else {
          await env.workbench.openFileDiff(model, commit, file)
        }
        return
      }
      case 'dropCommit': {
        if (message.action === 'duplicate') {
          const revset = message.mode === 'source' ? `${message.sourceId}::` : message.sourceId
          await env.operations.run('Duplicate', model, () =>
            model.repo.duplicate(revset, message.targetId),
          )
          return
        }
        if (
          message.sourceId === message.targetId ||
          model.findCommit(message.sourceId)?.isImmutable
        ) {
          return
        }
        await env.operations.run('Rebase', model, () =>
          model.repo.rebase(message.sourceId, message.targetId, message.mode),
        )
        return
      }
      case 'dropFile': {
        if (!model) {
          return
        }
        const target = model.findCommit(message.targetId)
        const source = model.findCommit(message.fromCommitId)
        if (!target || !source || target.isImmutable || message.fromCommitId === message.targetId) {
          return
        }
        if (message.action === 'copy') {
          await env.operations.run('Copy file', model, async () => {
            const paths = await copyPaths(model, message.fromCommitId, message.path)
            await model.repo.copyFiles(message.fromCommitId, message.targetId, paths)
          })
          return
        }
        if (source.isImmutable) {
          return
        }
        await env.operations.run('Move file', model, () =>
          model.repo.moveFiles(message.fromCommitId, message.targetId, [message.path]),
        )
        return
      }
      case 'dropBookmark':
        await env.operations.run('Move bookmark', model, async () => {
          await model.repo.setBookmark(message.name, message.targetId)
          model.placeBookmark(message.name, message.targetId)
        })
        return
      case 'openUrl': {
        const host = model.graph?.forge?.host
        if (host && isAllowedForgeUrl(message.url, host)) {
          await env.ui.openExternal(message.url)
        }
        return
      }
    }
  }
}

async function copyPaths(model: RepoModel, commitId: string, path: string): Promise<string[]> {
  const file = (await model.filesFor(commitId)).find((item) => item.path === path)
  if (file && file.sourcePath !== path) {
    return [file.sourcePath, path]
  }
  return [path]
}

type SuggestRequest = Extract<WebviewMessage, { type: 'suggestDescription' }>

async function suggestDescription(
  env: CommandEnv,
  model: RepoModel,
  message: SuggestRequest,
): Promise<void> {
  const { requestId } = message
  const reply = (result: { text: string } | { error: string }) =>
    env.graphView.post({ type: 'descriptionSuggestion', requestId, ...result })
  const commit = model.findCommit(message.commitId)
  if (!commit) {
    reply({ error: 'The change is no longer in the graph.' })
    return
  }
  try {
    reply({ text: await env.suggestions.suggest(model, commit, message.suggester, requestId) })
  } catch (error: unknown) {
    if (error instanceof SuggestionCancelled) {
      return
    }
    const text = error instanceof Error ? error.message : String(error)
    env.logger.error(`suggest description with ${message.suggester} failed: ${text}`)
    reply({ error: text })
  }
}
