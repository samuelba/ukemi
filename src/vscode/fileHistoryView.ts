import * as vscode from 'vscode'
import { authorLabel, type FileHistoryEntry } from '../../shared/fileHistory'
import { relativeTime } from '../../shared/format'
import { loadFileHistory } from '../app/fileHistory'
import type { RepoRegistry } from '../app/registry'
import type { RepoModel } from '../repo/repoModel'
import { errorMessage, type Logger } from '../util/logger'
import { readConfig } from './config'

const VIEW_ID = 'ukemi.fileHistory'

// The changes that touched one file, newest first. "Show File History" picks the file.
export class FileHistoryView
  implements vscode.TreeDataProvider<FileHistoryEntry>, vscode.Disposable
{
  private readonly change = new vscode.EventEmitter<FileHistoryEntry | undefined>()
  readonly onDidChangeTreeData = this.change.event
  private readonly tree: vscode.TreeView<FileHistoryEntry>
  private readonly disposables: vscode.Disposable[]
  private target: { model: RepoModel; path: string } | null = null
  private entries: FileHistoryEntry[] = []
  // The operation the entries were read at, so a refresh that changes nothing does not reload.
  private loadedAt: string | null = null
  private generation = 0

  constructor(
    private readonly registry: RepoRegistry,
    private readonly logger: Logger,
  ) {
    this.tree = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: this })
    this.disposables = [
      this.tree,
      this.change,
      registry.onDidChangeModel(() => {
        const operationId = this.target?.model.graph?.operationId ?? null
        if (this.target && operationId !== this.loadedAt) {
          void this.reload()
        }
      }),
    ]
  }

  async show(model: RepoModel, path: string): Promise<void> {
    this.target = { model, path }
    this.tree.title = `File History: ${path.split('/').pop() ?? path}`
    this.tree.description = path
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`)
    await this.reload()
  }

  getTreeItem(entry: FileHistoryEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(entry.summary || '(no description)')
    item.id = `${entry.repoId}\n${entry.path}\n${entry.commitId}`
    item.description = [
      entry.shortChangeId,
      authorLabel(entry),
      relativeTime(entry.time, Date.now()),
    ]
      .filter((part) => part.length > 0)
      .join(' · ')
    item.tooltip = `${entry.summary || '(no description)'}\n\nChange ${entry.changeId}\nCommit ${entry.commitId}\n${authorLabel(entry)} · ${entry.time}`
    item.iconPath = new vscode.ThemeIcon(entry.isWorkingCopy ? 'circle-filled' : 'git-commit')
    item.contextValue = entry.isWorkingCopy ? 'fileHistory+workingCopy' : 'fileHistory'
    item.command = {
      command: 'ukemi.fileHistory.openDiff',
      title: 'Show Changes to This File',
      arguments: [entry],
    }
    return item
  }

  getChildren(entry?: FileHistoryEntry): FileHistoryEntry[] {
    return entry ? [] : this.entries
  }

  dispose(): void {
    this.disposables.forEach((item) => item.dispose())
  }

  private async reload(): Promise<void> {
    const target = this.target
    if (!target || this.registry.modelFor(target.model.root) !== target.model) {
      this.entries = []
      this.change.fire(undefined)
      return
    }
    const generation = ++this.generation
    const operationId = target.model.graph?.operationId ?? null
    try {
      const entries = await loadFileHistory(target.model, target.path, readConfig().changeIdLength)
      if (generation === this.generation) {
        this.entries = entries
        this.loadedAt = operationId
        this.change.fire(undefined)
      }
    } catch (error: unknown) {
      this.logger.warn(`history of ${target.path} failed: ${errorMessage(error)}`)
      if (generation === this.generation) {
        this.entries = []
        this.loadedAt = operationId
        this.change.fire(undefined)
      }
    }
  }
}
