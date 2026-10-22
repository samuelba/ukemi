import { dirname, sep } from 'node:path'
import * as vscode from 'vscode'
import type { RepoSummary } from '../../shared/protocol'
import { JjRepo } from '../jj/repo'
import type { JjRunner } from '../jj/runner'
import { discoverRepos, findRepoRootUpwards, type RepoKind } from '../repo/discovery'
import { repoLabel } from '../repo/labels'
import { RepoModel } from '../repo/repoModel'
import type { Logger } from '../util/logger'
import { readConfig } from './config'

const ACTIVE_REFRESH_DELAY_MS = 400
const BACKGROUND_REFRESH_DELAY_MS = 3_000
const ACTIVE_REPO_KEY = 'ukemi.activeRepo'

interface RepoEntry {
  root: string
  kind: RepoKind
  model: RepoModel | null
  disposables: vscode.Disposable[]
  timer: NodeJS.Timeout | null
}

function isInternalPath(path: string): boolean {
  return path.includes(`${sep}.jj${sep}`) || path.includes(`${sep}.git${sep}`)
}

export class RepoRegistry implements vscode.Disposable {
  private readonly entries = new Map<string, RepoEntry>()
  private activeRoot: string | null = null
  private readonly changeEmitter = new vscode.EventEmitter<void>()
  private readonly modelEmitter = new vscode.EventEmitter<RepoModel>()
  private readonly disposables: vscode.Disposable[] = []

  readonly onDidChange = this.changeEmitter.event
  readonly onDidChangeModel = this.modelEmitter.event

  constructor(
    private readonly runner: JjRunner,
    private readonly logger: Logger,
    private readonly memento: vscode.Memento,
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.discover()),
      vscode.window.onDidChangeActiveTextEditor((editor) => void this.followEditor(editor)),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.activeModel?.markDirty()
          void this.activeModel?.refresh()
        }
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
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
      name: f.name,
      path: f.uri.fsPath,
    }))
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
    const config = readConfig()
    const folders = vscode.workspace.workspaceFolders ?? []
    const found = (
      await Promise.all(
        folders.map((f) =>
          discoverRepos(f.uri.fsPath, {
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

    const remembered = this.memento.get<string>(ACTIVE_REPO_KEY)
    const fallback = this.preferredRoot(remembered)
    await this.setActive(fallback, { remember: false })
    await this.followEditor(vscode.window.activeTextEditor)
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
      await this.memento.update(ACTIVE_REPO_KEY, root)
    }
    this.changeEmitter.fire()
    const model = this.activeModel
    if (model && (changed || !model.graph)) {
      await model.refresh()
    }
  }

  async addRepo(root: string): Promise<void> {
    const existing = this.entries.get(root)
    if (existing) {
      this.disposeEntry(existing)
    }
    this.entries.set(root, this.createEntry(root, 'jj'))
    await this.setActive(root)
  }

  private async followEditor(editor: vscode.TextEditor | undefined): Promise<void> {
    if (!editor || editor.document.uri.scheme !== 'file' || !readConfig().followActiveEditor) {
      return
    }
    const root = await findRepoRootUpwards(dirname(editor.document.uri.fsPath))
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
    const model = new RepoModel(new JjRepo(root, this.runner), this.logger, {
      depth: readConfig().historyDepth,
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

  private createWatchers(entry: RepoEntry, model: RepoModel): vscode.Disposable[] {
    const files = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(entry.root, '**/*'),
    )
    const onFile = (uri: vscode.Uri) => {
      if (isInternalPath(uri.fsPath)) {
        return
      }
      model.markDirty()
      this.scheduleRefresh(entry, model)
    }
    files.onDidChange(onFile)
    files.onDidCreate(onFile)
    files.onDidDelete(onFile)

    const ops = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(entry.root, '.jj/repo/op_heads/heads/*'),
    )
    const onOperation = () => void model.refreshIfOperationChanged()
    ops.onDidCreate(onOperation)
    ops.onDidChange(onOperation)
    return [files, ops]
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
