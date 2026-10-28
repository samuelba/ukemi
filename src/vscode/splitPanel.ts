import { chmod, mkdir, writeFile } from 'node:fs/promises'
import * as vscode from 'vscode'
import type { SplitHostMessage, SplitRequest, SplitWebviewMessage } from '../../shared/split'
import { SplitSession, wrapperScript } from '../split/splitSession'
import { errorMessage } from '../util/logger'
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
  const panel = vscode.window.createWebviewPanel(
    'ukemi.split',
    `Split ${shortId(commit)}`,
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
  panel.webview.html = webviewHtml(panel.webview, env.extensionUri, 'split')

  let disposed = false
  let ready = false
  let request: SplitRequest | null = null
  let session: SplitSession | null = null
  panel.onDidDispose(() => {
    disposed = true
  })

  const postLoad = async () => {
    if (disposed || !ready || !request) {
      return
    }
    const load: SplitHostMessage = { type: 'load', request }
    await panel.webview.postMessage(load)
  }

  panel.webview.onDidReceiveMessage(async (message: SplitWebviewMessage) => {
    switch (message.type) {
      case 'ready':
        ready = true
        await postLoad()
        return
      case 'cancel':
        panel.dispose()
        return
      case 'apply': {
        const loaded = session
        if (!loaded) {
          return
        }
        const tool = await ensureWrapper(env)
        panel.dispose()
        await env.operations.run('Split', model, () =>
          loaded.apply(model.repo, tool, message.message, message.selections),
        )
        return
      }
    }
  })

  try {
    const files = await model.filesFor(commit.commitId)
    if (disposed) {
      return
    }
    if (files.length === 0) {
      panel.dispose()
      void vscode.window.showInformationMessage('Ukemi: this change has no files to split.')
      return
    }
    session = await SplitSession.load(
      model.repo,
      { commitId: commit.commitId, parentId: commit.parents[0], description: commit.description },
      files,
    )
    if (disposed) {
      return
    }
    request = session.request
    await postLoad()
  } catch (error: unknown) {
    if (!disposed) {
      panel.dispose()
      void vscode.window.showErrorMessage(`Ukemi: split failed to load: ${errorMessage(error)}`)
    }
  }
}
