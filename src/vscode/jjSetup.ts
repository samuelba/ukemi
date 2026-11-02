import { dirname } from 'node:path'
import * as vscode from 'vscode'
import { locateJj as locateAnyJj, versionText } from '../app/jjSetup'
import { downloadJj, MIN_JJ_VERSION, PINNED_RELEASE, type ResolvedJj } from '../jj/binary'
import { errorMessage, type Logger } from '../util/logger'
import { readConfig } from './config'
import { openSettings } from './openSettings'

export function locateJj(storageDir: string, logger: Logger): Promise<ResolvedJj | null> {
  return locateAnyJj(readConfig().jjPath, storageDir, logger)
}

export async function offerInstall(storageDir: string, logger: Logger): Promise<boolean> {
  const choice = await vscode.window.showInformationMessage(
    `Ukemi needs Jujutsu (jj) ${versionText(MIN_JJ_VERSION)} or newer.`,
    `Download jj ${PINNED_RELEASE.version}`,
    'Set Path',
    'Install Guide',
  )
  if (choice === 'Set Path') {
    openSettings('ukemi.jjPath')
    return false
  }
  if (choice === 'Install Guide') {
    await vscode.env.openExternal(
      vscode.Uri.parse('https://docs.jj-vcs.dev/latest/install-and-setup/'),
    )
    return false
  }
  if (!choice) {
    return false
  }
  return installJj(storageDir, logger)
}

export async function installJj(storageDir: string, logger: Logger): Promise<boolean> {
  try {
    const path = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Downloading jj ${PINNED_RELEASE.version}`,
      },
      () => downloadJj(storageDir, process.arch),
    )
    logger.info(`installed jj to ${path}`)
    return true
  } catch (error: unknown) {
    void vscode.window.showErrorMessage(`Ukemi: jj download failed: ${errorMessage(error)}`)
    return false
  }
}

export function updateTerminalPath(context: vscode.ExtensionContext, jj: ResolvedJj | null): void {
  const collection = context.environmentVariableCollection
  collection.clear()
  if (jj?.source === 'managed' && readConfig().addJjToTerminalPath) {
    collection.prepend('PATH', `${dirname(jj.path)}:`)
    collection.description = 'Adds the jj binary downloaded by Ukemi to PATH'
  }
}
