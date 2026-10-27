import * as vscode from 'vscode'
import type { ParsedBookmark } from '../jj/parse'
import {
  bookmarkGroups,
  bookmarkRows,
  type BookmarkGroupElement,
  type BookmarkRowElement,
} from '../repo/bookmarkItems'
import type { RepoRegistry } from './registry'

const FILTERING_CONTEXT = 'ukemi.bookmarks.filtering'

export interface BookmarkEmptyElement {
  kind: 'empty'
  id: string
  label: string
}

export type BookmarkTreeElement = BookmarkGroupElement | BookmarkRowElement | BookmarkEmptyElement

export class BookmarksView
  implements vscode.TreeDataProvider<BookmarkTreeElement>, vscode.Disposable
{
  private readonly change = new vscode.EventEmitter<BookmarkTreeElement | undefined>()
  readonly onDidChangeTreeData = this.change.event
  private readonly tree: vscode.TreeView<BookmarkTreeElement>
  private readonly disposables: vscode.Disposable[]
  private query = ''

  constructor(private readonly registry: RepoRegistry) {
    this.tree = vscode.window.createTreeView('ukemi.bookmarks', { treeDataProvider: this })
    const refresh = () => this.change.fire(undefined)
    this.disposables = [
      this.tree,
      registry.onDidChange(refresh),
      registry.onDidChangeModel(refresh),
    ]
    void vscode.commands.executeCommand('setContext', FILTERING_CONTEXT, false)
  }

  async promptFilter(): Promise<void> {
    const entered = await vscode.window.showInputBox({
      title: 'Filter Bookmarks',
      prompt: 'Filter by bookmark name',
      placeHolder: 'Filter by bookmark name',
      value: this.query,
    })
    if (entered === undefined) {
      return
    }
    this.applyQuery(entered)
  }

  clearFilter(): void {
    this.applyQuery('')
  }

  getTreeItem(element: BookmarkTreeElement): vscode.TreeItem {
    if (element.kind === 'group') {
      return groupItem(element)
    }
    if (element.kind === 'empty') {
      return emptyItem(element)
    }
    return rowItem(element)
  }

  getChildren(element?: BookmarkTreeElement): BookmarkTreeElement[] {
    const model = this.registry.activeModel
    if (!model) {
      return []
    }
    if (!element) {
      return this.rootElements(model.bookmarks, model.root)
    }
    if (element.kind === 'group') {
      return bookmarkRows(
        model.bookmarks,
        element,
        model.graph?.trunkName ?? null,
        model.graph?.hasRemotes ?? false,
        this.query,
      )
    }
    return []
  }

  dispose(): void {
    this.disposables.forEach((item) => item.dispose())
    this.change.dispose()
  }

  private rootElements(
    bookmarks: readonly ParsedBookmark[],
    repoId: string,
  ): BookmarkTreeElement[] {
    const groups = bookmarkGroups(bookmarks, repoId, this.query)
    if (groups.length > 0 || this.query.length === 0) {
      return groups
    }
    if (bookmarkGroups(bookmarks, repoId).length === 0) {
      return []
    }
    return [
      {
        kind: 'empty',
        id: `${repoId}\nfilter-empty`,
        label: `No bookmarks match "${this.query}"`,
      },
    ]
  }

  private applyQuery(value: string): void {
    const next = value.trim()
    if (next === this.query) {
      return
    }
    this.query = next
    this.tree.message = next.length > 0 ? `Filter: ${next}` : ''
    void vscode.commands.executeCommand('setContext', FILTERING_CONTEXT, next.length > 0)
    this.change.fire(undefined)
  }
}

function groupItem(element: BookmarkGroupElement): vscode.TreeItem {
  const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded)
  item.id = element.id
  item.iconPath = new vscode.ThemeIcon(element.remote === null ? 'bookmark' : 'cloud')
  item.contextValue = 'group'
  return item
}

function emptyItem(element: BookmarkEmptyElement): vscode.TreeItem {
  const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None)
  item.id = element.id
  item.contextValue = 'empty'
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
