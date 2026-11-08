import type { ChangeDetail, SidePanelRow } from '../../shared/desktopProtocol'
import type { CommitView } from '../../shared/protocol'
import type { RepoModel } from '../repo/repoModel'
import { evolutionVersionNodes } from '../repo/evolutionItems'
import { errorMessage, type Logger } from '../util/logger'

export type DetailModel = Pick<
  RepoModel,
  'root' | 'graph' | 'findCommit' | 'commitFor' | 'filesFor' | 'evolutionFor'
>

export interface DetailDeps {
  activeModel: () => DetailModel | null
  changeIdLength: () => number
  post: (detail: ChangeDetail | null) => void
  // Adds the inline buttons of a row.
  withActions: (row: SidePanelRow) => SidePanelRow
  logger: Logger
  now?: () => number
}

// The change details pane: the selected change, its files and its evolution. It follows the
// change through rewrites, by its change id.
export class DetailPresenter {
  private selected: { repoId: string; commitId: string; changeId: string } | null = null
  private generation = 0
  // What the renderer shows, so a refresh that changes nothing does not redraw the panel.
  private posted: string | null = null
  private postedChangeId: string | null = null

  constructor(private readonly deps: DetailDeps) {}

  async show(commitId: string): Promise<void> {
    const model = this.deps.activeModel()
    const commit = model?.findCommit(commitId)
    this.selected =
      model && commit ? { repoId: model.root, commitId, changeId: commit.changeId } : null
    await this.refresh()
  }

  async refresh(): Promise<void> {
    const generation = ++this.generation
    const model = this.deps.activeModel()
    const selected = this.selected
    const commit =
      model && selected?.repoId === model.root
        ? model.commitFor(selected.commitId, selected.changeId)
        : null
    if (!model || !selected || !commit) {
      this.post(null)
      return
    }
    this.selected = { ...selected, commitId: commit.commitId }
    try {
      const files = commit.isWorkingCopy
        ? (model.graph?.workingCopyFiles ?? [])
        : await model.filesFor(commit.commitId)
      const detail: ChangeDetail = { repoId: model.root, commit, files, evolution: null }
      // Another change shows "Loading…" at once; the same one is posted once, with its evolution, so the rows never blank out.
      if (generation === this.generation && this.postedChangeId !== commit.changeId) {
        this.post(detail)
      }
      const evolution = await this.evolution(model, commit)
      if (generation === this.generation) {
        this.post({ ...detail, evolution })
      }
    } catch (error: unknown) {
      this.deps.logger.warn(`loading the change details failed: ${errorMessage(error)}`)
    }
  }

  // A new page shows nothing yet, so the next refresh posts again.
  forgetPosted(): void {
    this.posted = null
    this.postedChangeId = null
  }

  private post(detail: ChangeDetail | null): void {
    const serialized = JSON.stringify(detail)
    if (serialized === this.posted) {
      return
    }
    this.posted = serialized
    this.postedChangeId = detail?.commit.changeId ?? null
    this.deps.post(detail)
  }

  private async evolution(model: DetailModel, commit: CommitView): Promise<SidePanelRow[]> {
    try {
      const entries = await model.evolutionFor(commit.commitId)
      return evolutionVersionNodes(
        entries,
        {
          repoId: model.root,
          commitId: commit.commitId,
          changeId: commit.changeId,
          isImmutable: commit.isImmutable,
        },
        { now: (this.deps.now ?? Date.now)(), changeIdLength: this.deps.changeIdLength() },
      ).map((node) =>
        this.deps.withActions({
          id: node.id,
          label: node.label,
          description: node.description,
          tooltip: node.tooltip,
          icon: node.versionCommitId === commit.commitId ? 'circle-filled' : 'circle-outline',
          contextValue: node.contextValue,
          view: 'ukemi.evolution',
          arg: node,
          ...(node.previousCommitId ? { defaultCommand: 'ukemi.evolution.open' } : {}),
        }),
      )
    } catch (error: unknown) {
      this.deps.logger.warn(`loading the evolution failed: ${errorMessage(error)}`)
      return []
    }
  }
}
