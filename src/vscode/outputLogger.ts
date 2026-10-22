import * as vscode from 'vscode'
import type { Logger } from '../util/logger'

export function createOutputLogger(channel: vscode.LogOutputChannel): Logger {
  return {
    info: (message) => channel.info(message),
    warn: (message) => channel.warn(message),
    error: (message) => channel.error(message),
  }
}
