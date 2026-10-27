import * as vscode from 'vscode'
import {
  bookmarkGroups,
  bookmarkRows,
  type BookmarkGroupElement,
  type BookmarkRowElement,
} from '../repo/bookmarkItems'
import type { RepoRegistry } from './registry'

export type BookmarkTreeElement = BookmarkGroupElement | BookmarkRowElement

export class BookmarksView
  implements vscode.TreeDataProvider<BookmarkTreeElement>, vscode.Disposable
{
  private readonly change = new vscode.EventEmitter<BookmarkTreeElement | undefined>()
  readonly onDidChangeTreeData = this.change.event
  private readonly disposables: vscode.Disposable[]

  constructor(private readonly registry: RepoRegistry) {
    const refresh = () => this.change.fire(undefined)
    this.disposables = [registry.onDidChange(refresh), registry.onDidChangeModel(refresh)]
  }

  getTreeItem(element: BookmarkTreeElement): vscode.TreeItem {
    if (element.kind === 'group') {
      return groupItem(element)
    }
    return rowItem(element)
  }

  getChildren(element?: BookmarkTreeElement): BookmarkTreeElement[] {
    const model = this.registry.activeModel
    if (!model) {
      return []
    }
    if (!element) {
      return bookmarkGroups(model.bookmarks, model.root)
    }
    if (element.kind === 'group') {
      return bookmarkRows(
        model.bookmarks,
        element,
        model.graph?.trunkName ?? null,
        model.graph?.hasRemotes ?? false,
      )
    }
    return []
  }

  dispose(): void {
    this.disposables.forEach((item) => item.dispose())
    this.change.dispose()
  }
}

function groupItem(element: BookmarkGroupElement): vscode.TreeItem {
  const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded)
  item.id = element.id
  item.iconPath = new vscode.ThemeIcon(element.remote === null ? 'bookmark' : 'cloud')
  item.contextValue = 'group'
  return item
}

function rowItem(element: BookmarkRowElement): vscode.TreeItem {
  const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None)
  item.id = element.id
  item.description = element.description.length > 0 ? element.description : undefined
  item.tooltip = tooltipFor(element.tooltipLines)
  item.iconPath = new vscode.ThemeIcon(rowIcon(element))
  item.contextValue = element.contextValue
  if (element.commitId) {
    item.command = {
      command: 'ukemi.bookmark.newChange',
      title: 'New Working Copy',
      arguments: [element],
    }
  }
  return item
}

function rowIcon(element: BookmarkRowElement): string {
  if (element.contextValue.includes('+conflict')) {
    return 'warning'
  }
  return element.remote === null ? 'bookmark' : 'cloud'
}

function tooltipFor(lines: readonly string[]): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString()
  for (const line of lines) {
    tooltip.appendText(line)
    tooltip.appendMarkdown('\n\n')
  }
  return tooltip
}
