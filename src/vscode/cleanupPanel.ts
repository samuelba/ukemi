import * as vscode from 'vscode'
import type { Commit } from '../../shared/model'
import type { CommitView } from '../../shared/protocol'
import type {
  CleanupHostMessage,
  CleanupSnapshot,
  CleanupWebviewMessage,
} from '../../shared/cleanup'
import { cleanupSteps, forgottenWorkspaceRoots } from '../repo/cleanupItems'
import { applyCleanupSteps, loadCleanup } from '../repo/loadCleanup'
import type { RepoModel } from '../repo/repoModel'
import { errorMessage } from '../util/logger'
import type { CommandEnv } from './commands/context'
import { openCommitDiff, openFileDiff } from './diff'
import { createUkemiPanel, webviewHtml } from './webviewPanel'

export function openCleanupPanel(env: CommandEnv, model: RepoModel): void {
  const panel = createUkemiPanel(env.extensionUri, 'ukemi.cleanup', 'Clean up')
  panel.webview.html = webviewHtml(panel.webview, env.extensionUri, 'cleanup')
  let snapshot: CleanupSnapshot | null = null
  let applied = false
  panel.webview.onDidReceiveMessage(async (message: CleanupWebviewMessage) => {
    switch (message.type) {
      case 'ready':
        await postSnapshot(panel, model, (next) => {
          snapshot = next
        })
        return
      case 'cancel':
        panel.dispose()
        return
      case 'apply': {
        if (applied || !snapshot) {
          return
        }
        applied = true
        const steps = cleanupSteps(snapshot, message.selection)
        const roots = forgottenWorkspaceRoots(snapshot, message.selection, model.root)
        panel.dispose()
        if (steps.length === 0) {
          return
        }
        const cleaned = await env.operations.run('Clean up', model, async () => {
          await applyCleanupSteps(model.repo, steps)
          return true
        })
        if (cleaned) {
          for (const root of roots) {
            await env.registry.remove(root)
          }
        }
        return
      }
      case 'loadFiles':
        await postFiles(panel, model, message.commitId)
        return
      case 'openFile':
        await openCleanupFile(model, message.commitId, message.path)
        return
      case 'openDiff':
        await openCleanupDiff(model, message.commitId)
        return
    }
  })
}

function commitView(commit: Commit): CommitView {
  return {
    ...commit,
    row: {
      id: commit.commitId,
      column: 0,
      width: 1,
      incoming: [],
      outgoing: [],
      passThrough: [],
    },
    isTrunk: false,
    requests: [],
  }
}

async function viewedCommit(model: RepoModel, commitId: string): Promise<CommitView | null> {
  const [commit] = await model.repo.log(commitId, 1)
  return commit ? commitView(commit) : null
}

async function postFiles(
  panel: vscode.WebviewPanel,
  model: RepoModel,
  commitId: string,
): Promise<void> {
  try {
    const files = await model.repo.files(commitId)
    const message: CleanupHostMessage = { type: 'files', commitId, files }
    await panel.webview.postMessage(message)
  } catch (error: unknown) {
    void vscode.window.showErrorMessage(`Clean up failed to load files: ${errorMessage(error)}`)
  }
}

async function withViewedCommit(
  model: RepoModel,
  commitId: string,
  open: (commit: CommitView) => Promise<void>,
): Promise<void> {
  try {
    const commit = await viewedCommit(model, commitId)
    if (!commit) {
      void vscode.window.showWarningMessage('Clean up could not find that change.')
      return
    }
    await open(commit)
  } catch (error: unknown) {
    void vscode.window.showErrorMessage(`Clean up failed to open the diff: ${errorMessage(error)}`)
  }
}

function openCleanupDiff(model: RepoModel, commitId: string): Promise<void> {
  return withViewedCommit(model, commitId, async (commit) =>
    openCommitDiff(model, commit, await model.repo.files(commitId)),
  )
}

function openCleanupFile(model: RepoModel, commitId: string, path: string): Promise<void> {
  return withViewedCommit(model, commitId, async (commit) => {
    const file = (await model.repo.files(commitId)).find((item) => item.path === path)
    if (!file) {
      void vscode.window.showWarningMessage('Clean up could not find that file.')
      return
    }
    await openFileDiff(model, commit, file)
  })
}

async function postSnapshot(
  panel: vscode.WebviewPanel,
  model: RepoModel,
  save: (snapshot: CleanupSnapshot) => void,
): Promise<void> {
  try {
    const snapshot = await loadCleanup(model.repo, openFolders())
    save(snapshot)
    const load: CleanupHostMessage = { type: 'load', snapshot }
    await panel.webview.postMessage(load)
  } catch (error: unknown) {
    void vscode.window.showErrorMessage(`Clean up failed to load: ${errorMessage(error)}`)
  }
}

function openFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath)
}
