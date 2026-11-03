import * as vscode from 'vscode'
import { operationNodes, type OperationNode } from '../repo/operationItems'
import type { RepoRegistry } from '../app/registry'

export class OperationsView implements vscode.TreeDataProvider<OperationNode>, vscode.Disposable {
  private readonly change = new vscode.EventEmitter<OperationNode | undefined>()
  readonly onDidChangeTreeData = this.change.event
  private readonly disposables: vscode.Disposable[]

  constructor(private readonly registry: RepoRegistry) {
    const refresh = () => this.change.fire(undefined)
    this.disposables = [registry.onDidChange(refresh), registry.onDidChangeModel(refresh)]
  }

  getTreeItem(element: OperationNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None)
    item.id = element.id
    item.description = element.description
    item.tooltip = element.tooltip
    item.contextValue = element.contextValue
    item.iconPath = new vscode.ThemeIcon(
      element.contextValue.includes('+current') ? 'circle-filled' : 'history',
    )
    return item
  }

  getChildren(element?: OperationNode): OperationNode[] {
    if (element) {
      return []
    }
    const model = this.registry.activeModel
    return model ? operationNodes(model.root, model.operations, Date.now()) : []
  }

  dispose(): void {
    this.disposables.forEach((item) => item.dispose())
    this.change.dispose()
  }
}
