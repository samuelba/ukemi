import * as vscode from 'vscode'
import { shortId, title } from '../../shared/format'
import type { EvolutionEntry } from '../../shared/model'
import type { CommitView } from '../../shared/protocol'
import { evolutionVersionNodes, type EvolutionVersionNode } from '../repo/evolutionItems'
import { resolveSelectedCommit, type SelectedChange } from '../repo/selection'
import type { Logger } from '../util/logger'
import { errorMessage } from '../util/logger'
import type { ChangeSelection } from './changeSelection'
import { readConfig } from './config'
import type { RepoRegistry } from './registry'

export class EvolutionView
  implements vscode.TreeDataProvider<EvolutionVersionNode>, vscode.Disposable
{
  private readonly change = new vscode.EventEmitter<EvolutionVersionNode | undefined>()
  readonly onDidChangeTreeData = this.change.event
  private readonly tree: vscode.TreeView<EvolutionVersionNode>
  private readonly disposables: vscode.Disposable[]
  private nodes: EvolutionVersionNode[] = []
  private stale = true
  private failed = false
  private generation = 0
  private pending: Promise<EvolutionVersionNode[]> | null = null

  constructor(
    private readonly registry: RepoRegistry,
    private readonly selection: ChangeSelection,
    private readonly logger: Logger,
  ) {
    this.tree = vscode.window.createTreeView('ukemi.evolution', { treeDataProvider: this })
    const invalidate = () => this.invalidate()
    this.disposables = [
      this.tree,
      this.change,
      registry.onDidChange(invalidate),
      { dispose: selection.onDidChange(invalidate) },
      this.tree.onDidChangeVisibility(() => {
        if (!this.tree.visible) {
          return
        }
        if (this.failed) {
          this.invalidate()
          return
        }
        if (this.stale) {
          this.change.fire(undefined)
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('ukemi.changeIdLength')) {
          invalidate()
        }
      }),
    ]
  }

  currentSelection(): SelectedChange | null {
    const model = this.registry.activeModel
    const commit = this.target()?.commit
    if (!model || !commit) {
      return null
    }
    return { repoId: model.root, commitId: commit.commitId, changeId: commit.changeId }
  }

  getTreeItem(element: EvolutionVersionNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label)
    item.id = element.id
    item.description = element.description
    item.tooltip = element.tooltip
    item.contextValue = element.contextValue
    if (element.previousCommitId) {
      item.command = {
        command: 'ukemi.evolution.open',
        title: 'Show Changes in This Version',
        arguments: [element],
      }
    }
    return item
  }

  getChildren(element?: EvolutionVersionNode): vscode.ProviderResult<EvolutionVersionNode[]> {
    if (element) {
      return []
    }
    if (!this.tree.visible) {
      return this.nodes
    }
    if (!this.stale) {
      return this.nodes
    }
    if (this.pending) {
      return this.pending
    }
    const run = this.reload().finally(() => {
      if (this.pending === run) {
        this.pending = null
      }
    })
    this.pending = run
    return run
  }

  dispose(): void {
    this.disposables.forEach((item) => item.dispose())
  }

  private invalidate(): void {
    this.generation += 1
    this.stale = true
    this.pending = null
    this.updateDescription()
    if (this.tree.visible) {
      this.change.fire(undefined)
    }
  }

  private async reload(): Promise<EvolutionVersionNode[]> {
    const generation = this.generation
    const target = this.target()
    this.updateDescription()
    const loaded = target ? await this.fetch(target) : []
    if (generation !== this.generation) {
      return this.nodes
    }
    this.stale = false
    if (loaded === null) {
      this.failed = true
      this.nodes = []
      return []
    }
    this.failed = false
    const config = readConfig()
    const model = this.registry.activeModel
    const commit = target?.commit
    this.nodes =
      model && commit
        ? evolutionVersionNodes(
            loaded,
            {
              repoId: model.root,
              commitId: commit.commitId,
              changeId: commit.changeId,
              isImmutable: commit.isImmutable,
            },
            { now: Date.now(), changeIdLength: config.changeIdLength },
          )
        : []
    return this.nodes
  }

  private async fetch(target: { commit: CommitView }): Promise<EvolutionEntry[] | null> {
    const model = this.registry.activeModel
    if (!model) {
      return []
    }
    try {
      return await model.repo.evolution(target.commit.commitId)
    } catch (error: unknown) {
      this.logger.warn(`Evolution of ${target.commit.changeId} failed: ${errorMessage(error)}`)
      return null
    }
  }

  private target(): { commit: CommitView } | null {
    const model = this.registry.activeModel
    const graph = model?.graph
    if (!model || !graph) {
      return null
    }
    const shown = this.selection.shown(model.root)
    const commits = graph.commits
    const commit = shown
      ? resolveSelectedCommit(commits, shown, model.root)
      : (commits.find((entry) => entry.isWorkingCopy) ?? null)
    return commit ? { commit } : null
  }

  private updateDescription(): void {
    const commit = this.target()?.commit
    if (!commit) {
      this.tree.description = undefined
      return
    }
    const config = readConfig()
    const shown = shortId(commit.changeId, commit.changePrefix, config.changeIdLength)
    const heading = title(commit.description) || '(no description)'
    this.tree.description = `${shown} ${heading}`
  }
}
