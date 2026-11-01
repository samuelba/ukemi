import * as vscode from 'vscode'
import { Emitter } from '../app/events'
import {
  readSettings,
  type SettingScope,
  type Settings,
  type SettingsChange,
  type UkemiConfig,
} from '../app/settings'

export type { SourceControlMode, UkemiConfig } from '../app/settings'

export function readConfig(): UkemiConfig {
  return readSettings(vscode.workspace.getConfiguration('ukemi'))
}

async function updateSetting(key: string, value: unknown, scope: SettingScope): Promise<void> {
  const config = vscode.workspace.getConfiguration('ukemi')
  const inspected = config.inspect(key)
  const target =
    scope === 'user'
      ? vscode.ConfigurationTarget.Global
      : inspected?.workspaceFolderValue !== undefined
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : inspected?.workspaceValue !== undefined
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global
  await config.update(key, value, target)
}

// The `ukemi.*` settings of VS Code, with their change events.
export function vscodeSettings(): Settings & vscode.Disposable {
  const emitter = new Emitter<SettingsChange>()
  const subscription = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('ukemi')) {
      emitter.fire({ affects: (key) => event.affectsConfiguration(`ukemi.${key}`) })
    }
  })
  return {
    read: readConfig,
    update: (key, value, scope = 'default') => updateSetting(key, value, scope),
    onDidChange: emitter.event,
    dispose: () => {
      subscription.dispose()
      emitter.dispose()
    },
  }
}
