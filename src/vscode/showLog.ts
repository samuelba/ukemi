import { readdir } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import * as vscode from 'vscode'

export const LOG_CHANNEL_NAME = 'Ukemi'

const SHOW_COMMAND_PREFIX = 'workbench.action.output.show.'
const GLASS_SHOW_OUTPUT_TAB = 'glass.showOutputChannelTab'

export interface OutputChannelIds {
  plain?: string
  scoped: string[]
  remote: string[]
}

// Cursor registers log channels as `<id>.workspaceId-<workspace>`, but outside glass
// OutputChannel.show() only reveals the unscoped id, so it silently does nothing.
export async function showLog(
  channel: vscode.OutputChannel,
  extensionId: string,
  storageUri: vscode.Uri | undefined,
  logUri: vscode.Uri,
): Promise<void> {
  if (vscode.env.appName !== 'Cursor') {
    channel.show()
    return
  }
  const commandIds = await vscode.commands.getCommands(true)
  const found = outputChannelIds(commandIds, extensionId, LOG_CHANNEL_NAME)
  const workspaceId = storageUri ? workspaceIdFromStoragePath(storageUri.fsPath) : undefined
  const channelId = selectOutputChannelId(found, workspaceId)
  if (!channelId) {
    channel.show()
    return
  }
  try {
    if (commandIds.includes(GLASS_SHOW_OUTPUT_TAB) && (await isGlassHost(logUri))) {
      await vscode.commands.executeCommand(GLASS_SHOW_OUTPUT_TAB, { outputChannelId: channelId })
    } else {
      await vscode.commands.executeCommand(`${SHOW_COMMAND_PREFIX}${channelId}`)
    }
  } catch {
    channel.show()
  }
}

export function outputChannelIds(
  commandIds: readonly string[],
  extensionId: string,
  channelName: string,
): OutputChannelIds {
  const base = `${extensionId}.${channelName}`
  const commandPrefix = `${SHOW_COMMAND_PREFIX}${base}`
  const found: OutputChannelIds = { scoped: [], remote: [] }
  for (const commandId of commandIds) {
    if (commandId !== commandPrefix && !commandId.startsWith(`${commandPrefix}.`)) {
      continue
    }
    const id = commandId.slice(SHOW_COMMAND_PREFIX.length)
    if (id === base) {
      found.plain = id
    } else if (id.startsWith(`${base}.workspaceId-`)) {
      found.scoped.push(id)
    } else if (id === `${base}.remote` || id.startsWith(`${base}.remote.workspaceId-`)) {
      found.remote.push(id)
    }
  }
  return found
}

export function selectOutputChannelId(
  found: OutputChannelIds,
  workspaceId?: string,
): string | undefined {
  return (
    pickScoped(found.scoped, workspaceId) ?? found.plain ?? pickScoped(found.remote, workspaceId)
  )
}

export function workspaceIdFromStoragePath(storagePath: string): string | undefined {
  const id = basename(dirname(storagePath))
  return id.length > 0 ? id : undefined
}

// Only the glass extension host writes `<name>.workspaceId-<id>.<host>.log`.
export function isGlassLogFile(fileNames: readonly string[], channelName: string): boolean {
  const prefix = `${channelName}.workspaceId-`
  return fileNames.some((name) => name.startsWith(prefix) && name.endsWith('.log'))
}

function pickScoped(ids: readonly string[], workspaceId?: string): string | undefined {
  if (workspaceId) {
    const match = ids.find((id) => workspaceIdOf(id) === workspaceId)
    if (match) {
      return match
    }
  }
  return ids.length === 1 ? ids[0] : undefined
}

function workspaceIdOf(channelId: string): string | undefined {
  const marker = '.workspaceId-'
  const index = channelId.lastIndexOf(marker)
  return index === -1 ? undefined : channelId.slice(index + marker.length)
}

async function isGlassHost(logUri: vscode.Uri): Promise<boolean> {
  try {
    return isGlassLogFile(await readdir(logUri.fsPath), LOG_CHANNEL_NAME)
  } catch {
    return false
  }
}
