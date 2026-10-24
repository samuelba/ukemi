import * as vscode from 'vscode'
import type { Workspace } from '../../shared/model'
import {
  compareWorkspaces,
  isCurrentWorkspace,
  isWorkspaceOpen,
  workspaceContextValue,
  workspaceItemDescription,
  workspaceItemLabel,
  workspaceTooltipLines,
  type WorkspaceTreeElement,
} from '../repo/workspaceItems'
import type { RepoRegistry } from './registry'

export class WorkspacesView
  implements vscode.TreeDataProvider<WorkspaceTreeElement>, vscode.Disposable
{
  private readonly change = new vscode.EventEmitter<WorkspaceTreeElement | undefined>()
  readonly onDidChangeTreeData = this.change.event
  private readonly disposables: vscode.Disposable[]

  constructor(private readonly registry: RepoRegistry) {
    const refresh = () => this.change.fire(undefined)
    this.disposables = [registry.onDidChange(refresh), registry.onDidChangeModel(refresh)]
  }

  getTreeItem(element: WorkspaceTreeElement): vscode.TreeItem {
    const { workspace } = element
    const item = new vscode.TreeItem(
      workspaceItemLabel(workspace.name, element.isCurrent),
      vscode.TreeItemCollapsibleState.None,
    )
    item.description = workspaceItemDescription(workspace)
    item.tooltip = tooltipFor(workspace)
    item.iconPath = new vscode.ThemeIcon(element.isCurrent ? 'home' : 'folder')
    item.contextValue = workspaceContextValue({
      isCurrent: element.isCurrent,
      isOpen: element.isOpen,
      isDefault: workspace.name === 'default',
      hasRoot: workspace.root !== null,
    })
    item.id = `${element.repoId}\n${workspace.name}`
    return item
  }

  getChildren(element?: WorkspaceTreeElement): WorkspaceTreeElement[] {
    if (element) {
      return []
    }
    const model = this.registry.activeModel
    const workspaces = model?.graph?.workspaces
    if (!model || !workspaces) {
      return []
    }
    const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath)
    return workspaces
      .map((workspace) => ({
        kind: 'workspace' as const,
        repoId: model.root,
        workspace,
        isCurrent: isCurrentWorkspace(workspace, model.root),
        isOpen: workspace.root !== null && isWorkspaceOpen(workspace.root, folders),
      }))
      .sort(compareWorkspaces)
  }

  dispose(): void {
    this.disposables.forEach((item) => item.dispose())
    this.change.dispose()
  }
}

function tooltipFor(workspace: Workspace): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString()
  for (const line of workspaceTooltipLines(workspace)) {
    tooltip.appendText(line)
    tooltip.appendMarkdown('\n\n')
  }
  return tooltip
}
