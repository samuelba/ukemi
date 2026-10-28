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
import { webviewHtml } from './graphView'

export function openCleanupPanel(env: CommandEnv, model: RepoModel): void {
  const panel = vscode.window.createWebviewPanel(
    'ukemi.cleanup',
    'Clean up',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(env.extensionUri, 'dist', 'webview')],
    },
  )
  panel.iconPath = {
    light: vscode.Uri.joinPath(env.extensionUri, 'resources', 'activity-light.svg'),
    dark: vscode.Uri.joinPath(env.extensionUri, 'resources', 'activity-dark.svg'),
  }
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

async function openCleanupDiff(model: RepoModel, commitId: string): Promise<void> {
  try {
    const commit = await viewedCommit(model, commitId)
    if (!commit) {
      void vscode.window.showWarningMessage('Clean up could not find that change.')
      return
    }
    await openCommitDiff(model, commit, await model.repo.files(commitId))
  } catch (error: unknown) {
    void vscode.window.showErrorMessage(`Clean up failed to open the diff: ${errorMessage(error)}`)
  }
}

async function openCleanupFile(model: RepoModel, commitId: string, path: string): Promise<void> {
  try {
    const commit = await viewedCommit(model, commitId)
    if (!commit) {
      void vscode.window.showWarningMessage('Clean up could not find that change.')
      return
    }
    const file = (await model.repo.files(commitId)).find((item) => item.path === path)
    if (!file) {
      void vscode.window.showWarningMessage('Clean up could not find that file.')
      return
    }
    await openFileDiff(model, commit, file)
  } catch (error: unknown) {
    void vscode.window.showErrorMessage(`Clean up failed to open the diff: ${errorMessage(error)}`)
  }
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
