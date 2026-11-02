import type { SidePanelGroup, SidePanelRow, SidePanels } from '../../shared/desktopProtocol'
import { bookmarkGroups, bookmarkRows, type BookmarkRowElement } from '../repo/bookmarkItems'
import type { RepoModel } from '../repo/repoModel'
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

function bookmarkIcon(row: BookmarkRowElement): string {
  if (row.contextValue.includes('+conflict')) {
    return 'warning'
  }
  return row.remote === null ? 'bookmark' : 'cloud'
}

function bookmarkPanel(model: RepoModel, query: string): SidePanelGroup[] {
  const trunk = model.graph?.trunkName ?? null
  const hasRemotes = model.graph?.hasRemotes ?? false
  return bookmarkGroups(model.bookmarks, model.root, query).map((group) => ({
    id: group.id,
    label: group.label,
    icon: group.remote === null ? 'bookmark' : 'cloud',
    rows: bookmarkRows(model.bookmarks, group, trunk, hasRemotes, query).map(
      (row): SidePanelRow => ({
        id: row.id,
        label: row.label,
        description: row.description,
        tooltip: row.tooltipLines.join('\n'),
        icon: bookmarkIcon(row),
        contextValue: row.contextValue,
        view: 'ukemi.bookmarks',
        arg: row,
        ...(row.commitId ? { defaultCommand: 'ukemi.bookmark.newChange' } : {}),
      }),
    ),
  }))
}

function workspacePanel(model: RepoModel, openFolders: readonly string[]): SidePanelRow[] {
  const elements: WorkspaceTreeElement[] = (model.graph?.workspaces ?? []).map((workspace) => ({
    kind: 'workspace',
    repoId: model.root,
    workspace,
    isCurrent: isCurrentWorkspace(workspace, model.root),
    isOpen: workspace.root !== null && isWorkspaceOpen(workspace.root, openFolders),
  }))
  return elements.sort(compareWorkspaces).map((element) => ({
    id: `${element.repoId}\n${element.workspace.name}`,
    label: workspaceItemLabel(element.workspace.name, element.isCurrent),
    description: workspaceItemDescription(element.workspace),
    tooltip: workspaceTooltipLines(element.workspace).join('\n'),
    icon: element.isCurrent ? 'home' : 'folder',
    contextValue: workspaceContextValue({
      isCurrent: element.isCurrent,
      isOpen: element.isOpen,
      isDefault: element.workspace.name === 'default',
      hasRoot: element.workspace.root !== null,
    }),
    view: 'ukemi.workspaces',
    arg: element,
    defaultCommand: 'ukemi.workspace.reveal',
  }))
}

// The bookmarks and workspaces of the active repository, as the VS Code tree views list them.
export function sidePanels(
  model: RepoModel | null,
  openFolders: readonly string[],
  bookmarkQuery = '',
): SidePanels {
  if (!model) {
    return { bookmarks: [], workspaces: [] }
  }
  return {
    bookmarks: bookmarkPanel(model, bookmarkQuery),
    workspaces: workspacePanel(model, openFolders),
  }
}
