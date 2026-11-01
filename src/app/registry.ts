import { dirname } from 'node:path'
import type { RepoSummary } from '../../shared/protocol'
import { JjRepo } from '../jj/repo'
import type { JjRunner } from '../jj/runner'
import { discoverRepos, findRepoRootUpwards, type RepoKind } from '../repo/discovery'
import { repoLabel } from '../repo/labels'
import { RepoModel } from '../repo/repoModel'
import type { Logger } from '../util/logger'
import { Emitter, type Disposable } from './events'
import type { Host } from './host'
import { readView, rememberView, type GraphView } from './rememberedView'
import type { SettingsChange } from './settings'

const ACTIVE_REFRESH_DELAY_MS = 400
const BACKGROUND_REFRESH_DELAY_MS = 3_000
const ACTIVE_REPO_KEY = 'ukemi.activeRepo'

interface RepoEntry {
  root: string
  kind: RepoKind
  model: RepoModel | null
  disposables: Disposable[]
  timer: NodeJS.Timeout | null
}

export class RepoRegistry implements Disposable {
  private readonly entries = new Map<string, RepoEntry>()
  private activeRoot: string | null = null
  private readonly changeEmitter = new Emitter<void>()
  private readonly modelEmitter = new Emitter<RepoModel>()
  private readonly disposables: Disposable[] = []

  readonly onDidChange = this.changeEmitter.event
  readonly onDidChangeModel = this.modelEmitter.event

  constructor(
    private readonly runner: JjRunner,
    private readonly logger: Logger,
    private readonly host: Host,
  ) {
    this.disposables.push(
      host.folders.onDidChangeFolders(() => void this.discover()),
      host.folders.onDidChangeActiveFile((path) => void this.followFile(path)),
      host.window.onDidFocus(() => {
        this.activeModel?.markDirty()
        void this.activeModel?.refresh()
      }),
    )
  }

  get activeModel(): RepoModel | null {
    return (this.activeRoot && this.entries.get(this.activeRoot)?.model) || null
  }

  get activeRepoId(): string | null {
    return this.activeRoot
  }

  get models(): RepoModel[] {
    return [...this.entries.values()].flatMap((e) => (e.model ? [e.model] : []))
  }

  modelFor(root: string): RepoModel | null {
    return this.entries.get(root)?.model ?? null
  }

  summaries(): RepoSummary[] {
    const folders = this.host.folders.folders()
    return [...this.entries.values()]
      .map((e) => ({
        id: e.root,
        label: repoLabel(e.root, folders),
        kind: e.kind,
        changedFiles: e.model?.graph?.workingCopyFiles.length ?? 0,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }

  async discover(): Promise<void> {
    const config = this.host.settings.read()
    const folders = this.host.folders.folders()
    const found = (
      await Promise.all(
        folders.map((f) =>
          discoverRepos(f.path, {
            maxDepth: config.repoScanDepth,
            exclude: config.repoScanExclude,
          }),
        ),
      )
    ).flat()

    const roots = new Set(found.map((r) => r.root))
    for (const [root, entry] of this.entries) {
      if (!roots.has(root)) {
        this.disposeEntry(entry)
        this.entries.delete(root)
      }
    }
    for (const repo of found) {
      const existing = this.entries.get(repo.root)
      if (!existing || existing.kind !== repo.kind) {
        if (existing) {
          this.disposeEntry(existing)
        }
        this.entries.set(repo.root, this.createEntry(repo.root, repo.kind))
      }
    }

    const remembered = this.host.store.get<string>(ACTIVE_REPO_KEY)
    const fallback = this.preferredRoot(remembered)
    await this.setActive(fallback, { remember: false })
    await this.followFile(this.host.folders.activeFile())
  }

  private preferredRoot(remembered: string | undefined): string | null {
    if (this.activeRoot && this.entries.has(this.activeRoot)) {
      return this.activeRoot
    }
    if (remembered && this.entries.has(remembered)) {
      return remembered
    }
    const jjRepo = [...this.entries.values()].find((e) => e.kind === 'jj')
    return jjRepo?.root ?? [...this.entries.keys()][0] ?? null
  }

  async setActive(root: string | null, options: { remember: boolean } = { remember: true }) {
    const changed = root !== this.activeRoot
    this.activeRoot = root
    if (options.remember && root) {
      await this.host.store.update(ACTIVE_REPO_KEY, root)
    }
    this.changeEmitter.fire()
    const model = this.activeModel
    if (model && (changed || !model.graph)) {
      await model.refresh()
    }
  }

  // Each repository can override these, so a change only reaches the ones it affects.
  applyWorkspaceSettings(change?: SettingsChange): void {
    for (const model of this.modelsAffected('workspaces.snapshotOnRefresh', change)) {
      model.setSnapshotOtherWorkspaces(this.host.settings.read(model.root).snapshotOnRefresh)
    }
  }

  applyLineStats(change?: SettingsChange): Promise<void> {
    const models = this.modelsAffected('showLineStats', change)
    return Promise.all(
      models.map((model) =>
        model.setShowLineStats(this.host.settings.read(model.root).showLineStats),
      ),
    ).then(() => undefined)
  }

  // The graph opens with this filter and depth the next time the repository opens.
  rememberView(root: string, view: GraphView): PromiseLike<void> {
    return rememberView(this.host.store, root, view, this.defaultView(root))
  }

  private defaultView(root: string): GraphView {
    const config = this.host.settings.read(root)
    return { filter: config.defaultFilter, depth: config.historyDepth }
  }

  private modelsAffected(key: string, change: SettingsChange | undefined): RepoModel[] {
    return this.models.filter((model) => !change || change.affects(key, model.root))
  }

  async remove(root: string): Promise<void> {
    const entry = this.entries.get(root)
    if (!entry) {
      return
    }
    this.disposeEntry(entry)
    this.entries.delete(root)
    if (this.activeRoot === root) {
      const remembered = this.host.store.get<string>(ACTIVE_REPO_KEY)
      await this.setActive(this.preferredRoot(remembered), { remember: false })
      return
    }
    this.changeEmitter.fire()
  }

  async addRepo(root: string): Promise<void> {
    const existing = this.entries.get(root)
    if (existing) {
      this.disposeEntry(existing)
    }
    this.entries.set(root, this.createEntry(root, 'jj'))
    await this.setActive(root)
  }

  private async followFile(path: string | undefined): Promise<void> {
    if (!path || !this.host.settings.read().followActiveEditor) {
      return
    }
    const root = await findRepoRootUpwards(dirname(path))
    if (!root || root === this.activeRoot) {
      return
    }
    if (!this.entries.has(root)) {
      this.entries.set(root, this.createEntry(root, 'jj'))
    }
    await this.setActive(root, { remember: false })
  }

  private createEntry(root: string, kind: RepoKind): RepoEntry {
    const entry: RepoEntry = { root, kind, model: null, disposables: [], timer: null }
    if (kind !== 'jj') {
      return entry
    }
    const config = this.host.settings.read(root)
    const view = readView(this.host.store, root, this.defaultView(root))
    const model = new RepoModel(new JjRepo(root, this.runner), this.logger, {
      depth: view?.depth ?? config.historyDepth,
      filter: view?.filter ?? config.defaultFilter,
      snapshotOtherWorkspaces: config.snapshotOnRefresh,
      showLineStats: config.showLineStats,
    })
    entry.model = model
    entry.disposables.push(
      { dispose: model.onDidChange(() => this.handleModelChange(model)) },
      ...this.createWatchers(entry, model),
    )
    return entry
  }

  private handleModelChange(model: RepoModel): void {
    this.modelEmitter.fire(model)
    this.changeEmitter.fire()
  }

  private createWatchers(entry: RepoEntry, model: RepoModel): Disposable[] {
    return [
      this.host.watchRepo(entry.root, {
        onFile: () => {
          model.markDirty()
          this.scheduleRefresh(entry, model)
        },
        onOperation: () => void model.refreshIfOperationChanged(),
      }),
    ]
  }

  private scheduleRefresh(entry: RepoEntry, model: RepoModel): void {
    if (entry.timer) {
      clearTimeout(entry.timer)
    }
    const delay =
      entry.root === this.activeRoot ? ACTIVE_REFRESH_DELAY_MS : BACKGROUND_REFRESH_DELAY_MS
    entry.timer = setTimeout(() => {
      entry.timer = null
      void model.refresh()
    }, delay)
  }

  private disposeEntry(entry: RepoEntry): void {
    if (entry.timer) {
      clearTimeout(entry.timer)
    }
    entry.disposables.forEach((d) => d.dispose())
  }

  dispose(): void {
    this.entries.forEach((e) => this.disposeEntry(e))
    this.entries.clear()
    this.disposables.forEach((d) => d.dispose())
    this.changeEmitter.dispose()
    this.modelEmitter.dispose()
  }
}
