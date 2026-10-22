import { chmod, mkdir, writeFile } from 'node:fs/promises'
import * as vscode from 'vscode'
import type { SplitHostMessage, SplitWebviewMessage } from '../../shared/split'
import { SplitSession, wrapperScript } from '../split/splitSession'
import type { CommandEnv, Target } from './commands/context'
import { shortId } from './commands/context'
import { webviewHtml } from './graphView'

async function ensureWrapper(env: CommandEnv): Promise<{ wrapperPath: string; workDir: string }> {
  const workDir = env.storageUri.fsPath
  await mkdir(workDir, { recursive: true })
  const wrapperPath = vscode.Uri.joinPath(env.storageUri, 'ukemi-split.sh').fsPath
  const toolPath = vscode.Uri.joinPath(env.extensionUri, 'dist', 'splitTool.js').fsPath
  await writeFile(wrapperPath, wrapperScript(process.execPath, [toolPath]))
  await chmod(wrapperPath, 0o755)
  return { wrapperPath, workDir }
}

export async function openSplitPanel(env: CommandEnv, { model, commit }: Target): Promise<void> {
  const files = await model.filesFor(commit.commitId)
  if (files.length === 0) {
    void vscode.window.showInformationMessage('Ukemi: this change has no files to split.')
    return
  }
  const session = await SplitSession.load(
    model.repo,
    { commitId: commit.commitId, parentId: commit.parents[0], description: commit.description },
    files,
  )
  const panel = vscode.window.createWebviewPanel('ukemi.split', `Split ${shortId(commit)}`, vscode.ViewColumn.Active, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(env.extensionUri, 'dist', 'webview')],
  })
  panel.iconPath = vscode.Uri.joinPath(env.extensionUri, 'resources', 'activity.svg')
  panel.webview.html = webviewHtml(panel.webview, env.extensionUri, 'split')
  panel.webview.onDidReceiveMessage(async (message: SplitWebviewMessage) => {
    switch (message.type) {
      case 'ready': {
        const load: SplitHostMessage = { type: 'load', request: session.request }
        await panel.webview.postMessage(load)
        return
      }
      case 'cancel':
        panel.dispose()
        return
      case 'apply': {
        const tool = await ensureWrapper(env)
        panel.dispose()
        await env.operations.run('Split', model, () =>
          session.apply(model.repo, tool, message.message, message.selections),
        )
        return
      }
    }
  })
}
