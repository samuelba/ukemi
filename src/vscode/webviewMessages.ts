import * as vscode from 'vscode'
import type { WebviewMessage } from '../../shared/protocol'
import type { CommandEnv } from './commands/context'
import { editOrNew } from './commands/commitCommands'
import { initRepo } from './commands/globalCommands'
import { openFileAtRevision, openFileDiff } from './diff'

const ALLOWED_COMMAND = /^ukemi\./

export function createMessageHandler(env: CommandEnv) {
  return async (message: WebviewMessage): Promise<void> => {
    const model = env.registry.activeModel
    switch (message.type) {
      case 'selectRepo':
        await env.registry.setActive(message.repoId)
        return
      case 'command':
        if (ALLOWED_COMMAND.test(message.command)) {
          await vscode.commands.executeCommand(message.command, message.context)
        }
        return
      case 'dismissError':
        env.operations.dismissError()
        return
      case 'initRepo':
        await initRepo(env, message.root)
        return
      case 'installJj':
        await vscode.commands.executeCommand('ukemi.installJj')
        return
      case 'openFolder':
        await vscode.commands.executeCommand('workbench.action.files.openFolder')
        return
    }
    if (!model) {
      return
    }
    const graph = model.graph
    switch (message.type) {
      case 'setFilter':
        await env.operations.track('Loading', () =>
          model.setView(message.filter, graph?.depth ?? '7d'),
        )
        return
      case 'setDepth':
        await env.operations.track('Loading', () =>
          model.setView(graph?.filter ?? 'recent', message.depth),
        )
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
      case 'openFile': {
        const commit = model.findCommit(message.commitId)
        if (!commit) {
          return
        }
        const files = commit.isWorkingCopy
          ? (graph?.workingCopyFiles ?? [])
          : await model.filesFor(commit.commitId)
        const file = files.find((f) => f.path === message.path)
        if (message.mode === 'file' || !file) {
          await openFileAtRevision(model, commit, message.path)
        } else {
          await openFileDiff(model, commit, file)
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
        const target = model.findCommit(message.targetId)
        const source = model.findCommit(message.fromCommitId)
        if (
          !target ||
          !source ||
          target.isImmutable ||
          source.isImmutable ||
          message.fromCommitId === message.targetId
        ) {
          return
        }
        await env.operations.run('Move file', model, () =>
          model.repo.moveFiles(message.fromCommitId, message.targetId, [message.path]),
        )
        return
      }
      case 'dropBookmark':
        await env.operations.run('Move bookmark', model, () =>
          model.repo.setBookmark(message.name, message.targetId),
        )
        return
      case 'doubleClickCommit': {
        const commit = model.findCommit(message.commitId)
        if (commit) {
          await editOrNew(env, model, commit)
        }
        return
      }
    }
  }
}
