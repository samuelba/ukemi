import type * as vscode from 'vscode'
import type { CleanupHostMessage, CleanupWebviewMessage } from '../../shared/cleanup'
import { cleanupController } from '../app/cleanupController'
import type { CommandEnv } from '../app/commands/context'
import type { RepoModel } from '../repo/repoModel'
import { connectPanel, createUkemiPanel, webviewHtml } from './webviewPanel'

export function openCleanupPanel(
  env: CommandEnv,
  extensionUri: vscode.Uri,
  model: RepoModel,
): void {
  const panel = createUkemiPanel(extensionUri, 'ukemi.cleanup', 'Clean up')
  panel.webview.html = webviewHtml(panel.webview, extensionUri, 'cleanup')
  connectPanel<CleanupHostMessage, CleanupWebviewMessage>(panel, (channel) =>
    cleanupController(env, model, channel),
  )
}
