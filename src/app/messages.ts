import type { WebviewMessage } from '../../shared/protocol'
import { isAllowedForgeUrl } from '../forge/hostName'
import { changeRevision } from '../jj/revsets'
import type { RepoModel } from '../repo/repoModel'
import type { CommandEnv } from './commands/context'
import { SuggestionCancelled } from './describeSuggest/suggesters'
import { initRepo } from './commands/globalCommands'
import { savedRevsetByLabel, savedRevsetList, withSavedRevset } from '../../shared/savedRevsets'
import { updateWhereItLives } from './settings'
import { confirm } from './ui'

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
      case 'setRevset': {
        await applyRevset(env, model, message.revset.trim())
        return
      }
      case 'saveRevset':
        await saveRevset(env, model.root, message.revset)
        return
      case 'editSavedRevsets':
        env.workbench.openSettings(SAVED_REVSETS_SETTING)
        return
      case 'loadMore':
        await env.operations.track('Loading', () => model.loadMore())
        return
      case 'listRevsets':
        env.graphView.post({
          type: 'revsetHistory',
          repoId: model.root,
          history: env.registry.revsetHistory(model.root),
        })
        return
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
        // The dialog stays open across refreshes, so the change may have a new commit by now.
        const commit =
          model.commitFor(message.commitId, message.changeId) ??
          model.latestCommit(message.commitId)
        if (!commit) {
          await descriptionNotSaved(env, message.message)
          return
        }
        await env.operations.run('Describe', model, async () => {
          await model.repo.describe(changeRevision(commit), message.message)
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
          const source = model.revisionFor(message.sourceId)
          const revset = message.mode === 'source' ? `${source}::` : source
          await env.operations.run('Duplicate', model, () =>
            model.repo.duplicate(revset, model.revisionFor(message.targetId)),
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
          model.repo.rebase(
            model.revisionFor(message.sourceId),
            model.revisionFor(message.targetId),
            message.mode,
          ),
        )
        return
      }
      case 'insertCommit': {
        const { sourceId, afterId, beforeId } = message
        if (sourceId === afterId || sourceId === beforeId) {
          return
        }
        const after = model.revisionFor(afterId)
        const before = model.revisionFor(beforeId)
        if (message.action === 'duplicate') {
          const source = model.revisionFor(sourceId)
          const revset = message.mode === 'source' ? `${source}::` : source
          await env.operations.run('Duplicate', model, () =>
            model.repo.duplicateBetween(revset, after, before),
          )
          return
        }
        if (model.findCommit(sourceId)?.isImmutable) {
          return
        }
        await env.operations.run('Rebase', model, () =>
          model.repo.rebaseBetween(model.revisionFor(sourceId), message.mode, after, before),
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
            await model.repo.copyFiles(
              model.revisionFor(message.fromCommitId),
              model.revisionFor(message.targetId),
              paths,
            )
          })
          return
        }
        if (source.isImmutable) {
          return
        }
        await env.operations.run('Move file', model, () =>
          model.repo.moveFiles(
            model.revisionFor(message.fromCommitId),
            model.revisionFor(message.targetId),
            [message.path],
          ),
        )
        return
      }
      case 'dropBookmark':
        await env.operations.run('Move bookmark', model, async () => {
          await model.repo.setBookmark(message.name, model.revisionFor(message.targetId))
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

// The change was abandoned, or rewritten into several, while the dialog was open. The text is the
// user's work, so it is offered for copying instead of being dropped.
async function descriptionNotSaved(env: CommandEnv, text: string): Promise<void> {
  const copy = 'Copy Description'
  const choice = await env.ui.warn(
    'Ukemi: the change was rewritten or abandoned while you described it, so the description was not saved.',
    copy,
  )
  if (choice === copy) {
    await env.ui.copy(text)
  }
}

const SAVED_REVSETS_KEY = 'savedRevsets'
const SAVED_REVSETS_SETTING = `ukemi.${SAVED_REVSETS_KEY}`
const LABEL_SUGGESTION_LENGTH = 30

// A name to start from: the revset itself, cut short when it is long.
function suggestedLabel(revset: string): string {
  return revset.length <= LABEL_SUGGESTION_LENGTH
    ? revset
    : `${revset.slice(0, LABEL_SUGGESTION_LENGTH - 1)}…`
}

// Adds the revset to the saved ones under a name the user picks. It goes into the list the
// repository sees: its own when it overrides the setting, the global one otherwise.
async function saveRevset(env: CommandEnv, root: string, revset: string): Promise<void> {
  const text = revset.trim()
  if (text === '') {
    return
  }
  const label = (
    await env.ui.input({
      title: 'Save Revset',
      prompt: `Name for ${text} in the filter menu`,
      value: suggestedLabel(text),
      validate: (value) => (value.trim() === '' ? 'Enter a name.' : null),
    })
  )?.trim()
  if (!label) {
    return
  }
  const values = env.settings.inspect(SAVED_REVSETS_KEY, root)
  const current = values.repoValue ?? values.globalValue
  const existing = savedRevsetByLabel(savedRevsetList(current), label)
  if (existing && existing.revset !== text) {
    const replace = await confirm(
      env.ui,
      `A saved revset is already called "${label}". Replace it?`,
      'Replace',
      `It shows ${existing.revset}.`,
    )
    if (!replace) {
      return
    }
  }
  try {
    await updateWhereItLives(
      env.settings,
      SAVED_REVSETS_KEY,
      withSavedRevset(current, label, text),
      root,
    )
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    env.logger.error(`saving revset "${label}" failed: ${reason}`)
    await env.ui.error(`Ukemi: could not save the revset "${label}": ${reason}`)
  }
}

// Checks the typed revset before the graph switches to it, so a typo keeps the current graph and
// is not remembered. An empty revset goes back to the filter.
async function applyRevset(env: CommandEnv, model: RepoModel, revset: string): Promise<void> {
  const graph = model.graph
  const filter = graph?.filter ?? 'recent'
  const depth = graph?.depth ?? '7d'
  const error = revset === '' ? null : await model.repo.revsetError(revset)
  env.graphView.post({ type: 'revsetResult', revset, error })
  if (error !== null) {
    return
  }
  const custom = revset === '' ? null : revset
  await env.operations.track('Loading', () => model.setView(filter, depth, custom))
  await env.registry.rememberView(
    model.root,
    custom ? { filter, depth, revset } : { filter, depth },
  )
  if (custom) {
    await env.registry.rememberRevset(model.root, custom)
    env.graphView.post({
      type: 'revsetHistory',
      repoId: model.root,
      history: env.registry.revsetHistory(model.root),
    })
  }
}
