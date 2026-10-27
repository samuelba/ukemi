import { resolve } from 'node:path'
import { layoutGraph, type GraphRow } from '../../shared/graphLayout'
import type { ChangedFile, Commit, GraphFilter, HistoryDepth, Workspace } from '../../shared/model'
import type { CommitView, ForgeState, GraphState, RequestBadge } from '../../shared/protocol'
import { buildGraphNodes } from '../graph/buildGraph'
import { JjRepo } from '../jj/repo'
import { CURRENT_BOOKMARKS_REVSET, graphRevset } from '../jj/revsets'
import type { Logger } from '../util/logger'
import { errorMessage } from '../util/logger'
import { resolveSelectedCommit } from './selection'
import { canRedo, UNDO_HISTORY_LIMIT } from './undoState'

const FILE_CACHE_LIMIT = 200
const NETWORK_OPERATION = /^(fetch from git remote|push .*to git remote)/

export type ChangeListener = () => void

export class RepoModel {
  private filter: GraphFilter = 'recent'
  private depth: HistoryDepth = '7d'
  private current: GraphState | null = null
  private lastError: string | null = null
  private isDirty = true
  private lastOperationId: string | null = null
  private tail: Promise<void> | null = null
  private isRefreshQueued = false
  private requests: RequestBadge[] = []
  private forge: ForgeState | null = null
  private snapshotOtherWorkspaces = false
  private showLineStats = false
  private readonly fileCache = new Map<string, ChangedFile[]>()
  private readonly listeners = new Set<ChangeListener>()

  constructor(
    readonly repo: JjRepo,
    private readonly logger: Logger,
    options: {
      depth?: HistoryDepth
      filter?: GraphFilter
      snapshotOtherWorkspaces?: boolean
      showLineStats?: boolean
    } = {},
  ) {
    this.depth = options.depth ?? this.depth
    this.filter = options.filter ?? this.filter
    this.snapshotOtherWorkspaces = options.snapshotOtherWorkspaces ?? false
    this.showLineStats = options.showLineStats ?? false
  }

  get root(): string {
    return this.repo.root
  }

  get graph(): GraphState | null {
    return this.current
  }

  get error(): string | null {
    return this.lastError
  }

  onDidChange(listener: ChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  markDirty(): void {
    this.isDirty = true
  }

  setSnapshotOtherWorkspaces(enabled: boolean): void {
    this.snapshotOtherWorkspaces = enabled
  }

  setShowLineStats(enabled: boolean): Promise<void> {
    if (this.showLineStats === enabled) {
      return Promise.resolve()
    }
    this.showLineStats = enabled
    this.fileCache.clear()
    return this.refresh()
  }

  setView(filter: GraphFilter, depth: HistoryDepth): Promise<void> {
    this.filter = filter
    this.depth = depth
    return this.refresh()
  }

  setForge(forge: ForgeState | null, requests: readonly RequestBadge[]): void {
    this.forge = forge
    this.requests = [...requests]
    if (this.current) {
      this.current = {
        ...this.current,
        forge,
        commits: this.attachRequests(this.current.commits),
      }
      this.emit()
    }
  }

  findCommit(commitId: string): CommitView | undefined {
    return this.current?.commits.find((c) => c.commitId === commitId)
  }

  commitFor(commitId: string, changeId: string): CommitView | null {
    return resolveSelectedCommit(
      this.current?.commits ?? [],
      { repoId: this.root, commitId, changeId },
      this.root,
    )
  }

  async refreshIfOperationChanged(): Promise<void> {
    try {
      const [head] = await this.repo.operations(1)
      if (head && head.id !== this.lastOperationId) {
        await this.refresh()
      }
    } catch (error: unknown) {
      this.logger.warn(`operation check failed: ${errorMessage(error)}`)
    }
  }

  refresh(): Promise<void> {
    if (this.tail) {
      this.isRefreshQueued = true
      return this.tail
    }
    this.tail = this.startRefresh()
    return this.tail
  }

  // A refresh requested during load stays on this promise, so the next jj command waits until the repo is idle.
  private startRefresh(): Promise<void> {
    const run = this.load().finally(() => {
      if (!this.isRefreshQueued) {
        this.tail = null
        return
      }
      this.isRefreshQueued = false
      this.tail = this.startRefresh()
    })
    return run.then(() => this.tail ?? undefined)
  }

  private async load(): Promise<void> {
    try {
      if (this.isDirty) {
        this.isDirty = false
        await this.repo.snapshot()
      }
      if (this.snapshotOtherWorkspaces) {
        await this.snapshotOthers()
      }
      this.current = await this.buildState()
      this.lastError = null
    } catch (error: unknown) {
      this.lastError = errorMessage(error)
      this.logger.error(`refresh failed: ${this.lastError}`)
    }
    this.emit()
  }

  private async buildState(): Promise<GraphState> {
    const revset = graphRevset(this.filter, this.depth)
    const [logged, trunkIds, operations, workspaces, remotes, trunkName, pushed, currentBookmarks] =
      await Promise.all([
        this.repo.log(revset),
        this.repo.commitIds('present(trunk())'),
        this.repo.operations(UNDO_HISTORY_LIMIT),
        this.repo.workspaces(),
        this.repo.remotes(),
        this.repo.trunkBookmark(),
        this.repo.pushedBookmarkNames(),
        this.repo.bookmarkNames(CURRENT_BOOKMARKS_REVSET),
      ])
    const commits = remotes.length > 0 ? markNeverPushed(logged, pushed) : logged
    const nodes = await buildGraphNodes(commits, (parent) =>
      this.repo.commitIds(`heads(::${parent} & (${revset}))`),
    )
    const rows = layoutGraph(nodes)
    const trunkId = trunkIds[0]
    const workingCopy = commits.find((c) => c.isWorkingCopy)
    const workingCopyFiles = workingCopy
      ? await this.repo.files(workingCopy.commitId, this.showLineStats)
      : []
    const head = operations[0]
    this.lastOperationId = head?.id ?? null

    const views = commits.map((commit, index) => toCommitView(commit, rows[index], trunkId))

    return {
      repoId: this.root,
      commits: this.attachRequests(views),
      workingCopyFiles,
      workspaces,
      filter: this.filter,
      depth: this.depth,
      hasRemotes: remotes.length > 0,
      hasUnpushed: remotes.length > 0 && hasUnsyncedBookmarks(commits),
      canUndo: head !== undefined && !NETWORK_OPERATION.test(head.description),
      canRedo: canRedo(operations.map((op) => op.description)),
      currentBookmarks,
      trunkName,
      forge: this.forge,
    }
  }

  private async snapshotOthers(): Promise<void> {
    let listed: Workspace[]
    try {
      listed = await this.repo.workspaces()
    } catch (error: unknown) {
      this.logger.warn(`workspace list failed: ${errorMessage(error)}`)
      return
    }
    for (const workspace of listed) {
      if (!workspace.root || resolve(workspace.root) === resolve(this.root)) {
        continue
      }
      try {
        await this.repo.snapshotWorkspace(workspace.root)
      } catch (error: unknown) {
        this.logger.warn(`snapshot ${workspace.name} failed: ${errorMessage(error)}`)
      }
    }
  }

  private attachRequests(commits: readonly CommitView[]): CommitView[] {
    return commits.map((commit) => ({
      ...commit,
      requests: this.requests.filter(
        (r) =>
          commit.localBookmarks.some((b) => b.name === r.headBranch) ||
          commit.remoteBookmarks.some((b) => b.name === r.headBranch),
      ),
    }))
  }

  async filesFor(commitId: string): Promise<ChangedFile[]> {
    const key = `${this.showLineStats ? '1' : '0'}\n${commitId}`
    const cached = this.fileCache.get(key)
    if (cached) {
      return cached
    }
    const withStats = this.showLineStats
    const files = await this.repo.files(commitId, withStats)
    if (withStats !== this.showLineStats) {
      return files
    }
    if (this.fileCache.size >= FILE_CACHE_LIMIT) {
      const oldest = this.fileCache.keys().next().value
      if (oldest !== undefined) {
        this.fileCache.delete(oldest)
      }
    }
    this.fileCache.set(key, files)
    return files
  }
}

function toCommitView(
  commit: Commit,
  row: GraphRow | undefined,
  trunkId: string | undefined,
): CommitView {
  return {
    ...commit,
    row: row ?? {
      id: commit.commitId,
      column: 0,
      width: 1,
      incoming: [],
      outgoing: [],
      passThrough: [],
    },
    isTrunk: commit.commitId === trunkId,
    requests: [],
  }
}

function markNeverPushed(commits: readonly Commit[], pushed: ReadonlySet<string>): Commit[] {
  return commits.map((commit) =>
    commit.localBookmarks.every((b) => pushed.has(b.name))
      ? commit
      : {
          ...commit,
          localBookmarks: commit.localBookmarks.map((b) =>
            pushed.has(b.name) ? b : { ...b, synced: false },
          ),
        },
  )
}

function hasUnsyncedBookmarks(commits: readonly Commit[]): boolean {
  return commits.some((c) => c.localBookmarks.some((b) => !b.synced))
}
