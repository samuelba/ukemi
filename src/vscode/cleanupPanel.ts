import * as vscode from 'vscode'
import type {
  CleanupHostMessage,
  CleanupSnapshot,
  CleanupWebviewMessage,
} from '../../shared/cleanup'
import { cleanupSteps } from '../repo/cleanupItems'
import { applyCleanupSteps, loadCleanup } from '../repo/loadCleanup'
import type { RepoModel } from '../repo/repoModel'
import { errorMessage } from '../util/logger'
import type { CommandEnv } from './commands/context'
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
        panel.dispose()
        if (steps.length === 0) {
          return
        }
        await env.operations.run('Clean up', model, () => applyCleanupSteps(model.repo, steps))
        return
      }
    }
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
