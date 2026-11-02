import * as vscode from 'vscode'
import type { Handler } from '../../app/commands/context'
import { readConfig } from '../config'
import { GRAPH_VIEW_ID, type GraphView } from '../graphView'

// Where the graph opens is an editor choice: the sidebar or an editor panel.
export function viewCommands(graphView: GraphView): Record<string, Handler> {
  return {
    'ukemi.openView': async () => {
      if (readConfig().showInPanel) {
        graphView.openPanel()
        return
      }
      await vscode.commands.executeCommand(`${GRAPH_VIEW_ID}.focus`)
    },
    'ukemi.openPanel': async () => graphView.openPanel(),
  }
}
