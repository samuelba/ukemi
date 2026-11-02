import * as vscode from 'vscode'
import type { Handler } from '../../app/commands/context'

export function registerAll(
  context: vscode.ExtensionContext,
  handlers: Record<string, Handler>,
): void {
  for (const [id, handler] of Object.entries(handlers)) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler))
  }
}
