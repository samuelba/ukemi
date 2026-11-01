import * as vscode from 'vscode'
import type { CommandEnv, Workbench } from '../app/commands/context'
import { openCleanupPanel } from './cleanupPanel'
import { openCommitDiff, openFileAtRevision, openFileDiff, openVersionDiff } from './diff'
import { openSettings } from './openSettings'
import { openSplitPanel } from './splitPanel'

export interface ExtensionPaths {
  extensionId: string
  extensionUri: vscode.Uri
  storageUri: vscode.Uri
}

// The editor side of the commands. `env` is read lazily because it holds this workbench.
export function vscodeWorkbench(
  paths: ExtensionPaths,
  env: () => CommandEnv,
  installJj: () => Promise<void>,
): Workbench {
  return {
    openFileDiff,
    openCommitDiff,
    openVersionDiff,
    openFileAtRevision,
    openSplit: async (target) => openSplitPanel(env(), paths, target),
    openCleanup: (model) => openCleanupPanel(env(), paths.extensionUri, model),
    openSettings: (key) => openSettings(key ?? `@ext:${paths.extensionId}`),
    openWindow: async (root) => {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), {
        forceNewWindow: true,
      })
    },
    addFolder: (root, name) => {
      const count = vscode.workspace.workspaceFolders?.length ?? 0
      return vscode.workspace.updateWorkspaceFolders(count, 0, { uri: vscode.Uri.file(root), name })
    },
    openTerminal: (cwd, name) => vscode.window.createTerminal({ cwd, name }).show(),
    installJj,
    openFolder: async () => {
      await vscode.commands.executeCommand('workbench.action.files.openFolder')
    },
  }
}
