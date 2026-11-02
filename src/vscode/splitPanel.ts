import * as vscode from 'vscode'
import type { SplitHostMessage, SplitWebviewMessage } from '../../shared/split'
import { shortId, type CommandEnv, type Target } from '../app/commands/context'
import { splitController } from '../app/splitController'
import { connectPanel, createUkemiPanel, webviewHtml } from './webviewPanel'

export function openSplitPanel(
  env: CommandEnv,
  extension: { extensionUri: vscode.Uri; storageUri: vscode.Uri },
  target: Target,
): void {
  const panel = createUkemiPanel(
    extension.extensionUri,
    'ukemi.split',
    `Split ${shortId(target.commit)}`,
  )
  panel.webview.html = webviewHtml(panel.webview, extension.extensionUri, 'split')
  connectPanel<SplitHostMessage, SplitWebviewMessage>(panel, (channel) =>
    splitController(env, target, channel, {
      storageDir: extension.storageUri.fsPath,
      toolPath: vscode.Uri.joinPath(extension.extensionUri, 'dist', 'splitTool.js').fsPath,
    }),
  )
}
