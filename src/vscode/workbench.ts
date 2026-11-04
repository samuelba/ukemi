import { join } from 'node:path'
import * as vscode from 'vscode'
import type { CommandEnv, Workbench } from '../app/commands/context'
import { openCleanupPanel } from './cleanupPanel'
import { openCommitDiff, openFileAtRevision, openFileDiff, openVersionDiff } from './diff'
import type { FileHistoryView } from './fileHistoryView'
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
  fileHistory: () => FileHistoryView,
): Workbench {
  return {
    openFileDiff,
    openCommitDiff,
    openVersionDiff,
    openFileAtRevision,
    // VS Code is the editor: the working copy's file opens in it, and its conflict lenses resolve.
    openEditor: async (model, commit, path) => {
      if (commit.isWorkingCopy) {
        await vscode.window.showTextDocument(vscode.Uri.file(join(model.root, path)))
        return
      }
      await openFileAtRevision(model, commit, path)
      void vscode.window.showInformationMessage(
        'Ukemi: only working-copy files can be edited here. Run "jj new" on the change to edit it.',
      )
    },
    showFileHistory: (model, path) => fileHistory().show(model, path),
    openFileExternally: async (fsPath) => {
      await vscode.window.showTextDocument(vscode.Uri.file(fsPath))
    },
    openSplit: async (target) => openSplitPanel(env(), paths, target),
    openCleanup: (model) => openCleanupPanel(env(), paths.extensionUri, model),
    openSettings: (key) => openSettings(key ?? `@ext:${paths.extensionId}`),
    // VS Code keeps repository settings in the settings of the workspace folder.
    openRepositorySettings: async () => {
      await vscode.commands.executeCommand('workbench.action.openFolderSettings')
    },
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
