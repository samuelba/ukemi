import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'
import type { PanelChannel, PanelHandler } from '../app/panel'

export function webviewRoot(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'dist', 'webview')
}

export function webviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  entry: string,
  bodyAttributes = '',
): string {
  const base = webviewRoot(extensionUri)
  const script = webview.asWebviewUri(vscode.Uri.joinPath(base, `${entry}.js`))
  const style = webview.asWebviewUri(vscode.Uri.joinPath(base, `${entry}.css`))
  const nonce = randomBytes(16).toString('base64')
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ')
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${style}">
</head>
<body${bodyAttributes}>
  <div id="root"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`
}

// Opens an editor panel with the Ukemi icon. Options override the defaults for a bundled webview.
export function createUkemiPanel(
  extensionUri: vscode.Uri,
  viewType: string,
  title: string,
  options: vscode.WebviewPanelOptions & vscode.WebviewOptions = {},
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.Active, {
    enableScripts: true,
    localResourceRoots: [webviewRoot(extensionUri)],
    ...options,
  })
  panel.iconPath = {
    light: vscode.Uri.joinPath(extensionUri, 'resources', 'activity-light.svg'),
    dark: vscode.Uri.joinPath(extensionUri, 'resources', 'activity-dark.svg'),
  }
  return panel
}

// Wraps a webview panel for an app controller, and routes the panel's messages to it.
export function connectPanel<H, W>(
  panel: vscode.WebviewPanel,
  connect: (channel: PanelChannel<H>) => PanelHandler<W>,
): void {
  let closed = false
  panel.onDidDispose(() => {
    closed = true
  })
  const channel: PanelChannel<H> = {
    post: (message) => panel.webview.postMessage(message),
    close: () => panel.dispose(),
    get isClosed() {
      return closed
    },
  }
  const handler = connect(channel)
  panel.webview.onDidReceiveMessage((message: W) => handler(message))
}
