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

function configuration(root?: string): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('ukemi', root ? vscode.Uri.file(root) : undefined)
}

// With a root, folder settings of the workspace folder that holds the repository apply too.
export function readConfig(root?: string): UkemiConfig {
  return readSettings(configuration(root))
}

async function updateSetting(key: string, value: unknown, scope: SettingScope): Promise<void> {
  if (typeof scope === 'object') {
    await configuration(scope.root).update(key, value, vscode.ConfigurationTarget.WorkspaceFolder)
    return
  }
  const config = configuration()
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
      emitter.fire({
        affects: (key, root) =>
          event.affectsConfiguration(`ukemi.${key}`, root ? vscode.Uri.file(root) : undefined),
      })
    }
  })
  return {
    read: readConfig,
    inspect: (key, root) => {
      const inspected = configuration(root).inspect(key)
      return {
        globalValue: inspected?.workspaceValue ?? inspected?.globalValue,
        repoValue: inspected?.workspaceFolderValue,
      }
    },
    update: (key, value, scope = 'default') => updateSetting(key, value, scope),
    onDidChange: emitter.event,
    dispose: () => {
      subscription.dispose()
      emitter.dispose()
    },
  }
}
