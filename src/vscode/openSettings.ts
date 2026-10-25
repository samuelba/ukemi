import * as vscode from 'vscode'

export function cursorSettingsLink(
  scheme: string,
  query: string,
): { scheme: string; authority: 'settings'; path: string } {
  const settingId = query.startsWith('@') ? undefined : query
  return {
    scheme,
    authority: 'settings',
    path: settingId ? `/${settingId}` : '/',
  }
}

// Cursor freezes if openSettings returns the editor across IPC with a query.
// A settings link opens the editor in the window. It keeps a setting id and drops an @ filter.
export function openSettings(query: string): void {
  const opened =
    vscode.env.appName === 'Cursor'
      ? openCursorSettings(query)
      : vscode.commands.executeCommand('workbench.action.openSettings', query)
  void Promise.resolve(opened).then(warnIfClosed, warn)
}

function openCursorSettings(query: string): Thenable<boolean> {
  const link = cursorSettingsLink(vscode.env.uriScheme, query)
  return vscode.env.openExternal(vscode.Uri.from(link))
}

function warnIfClosed(opened: unknown): void {
  if (opened === false) {
    warn()
  }
}

function warn(): void {
  void vscode.window.showWarningMessage('Ukemi: could not open Settings.')
}
