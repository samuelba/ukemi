import { resolve } from 'node:path'
import { layoutGraph, type GraphNodeInput, type GraphRow } from '../../shared/graphLayout'
import type {
  ChangedFile,
  Commit,
  GraphFilter,
  HistoryDepth,
  Operation,
  Remote,
  Workspace,
} from '../../shared/model'
import type { CommitView, ForgeState, GraphState, RequestBadge } from '../../shared/protocol'
import { withStackInfo } from '../../shared/stack'
import { graphFromAncestors } from '../graph/buildGraph'
import { ElisionCache } from '../graph/elisionCache'
import type { ParsedBookmark } from '../jj/parse'
import { JjRepo, type TrunkRef } from '../jj/repo'
import { CURRENT_BOOKMARKS_REVSET, graphRevset } from '../jj/revsets'
import type { Logger } from '../util/logger'
import { errorMessage } from '../util/logger'
import { placeBookmark as moveLocalBookmark } from './placeBookmark'
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
  private opEventDuringLoad = false
  private viewGeneration = 0
  private readonly elisionCache = new ElisionCache()
  private requests: RequestBadge[] = []
  private forge: ForgeState | null = null
  private snapshotOtherWorkspaces = false
  private showLineStats = false
  private readonly fileCache = new Map<string, ChangedFile[]>()
  private readonly listeners = new Set<ChangeListener>()
  private listedBookmarks: ParsedBookmark[] = []

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

  // Rows come from the graph load, which skips in_trunk (always false); use repo.bookmarkList() when it matters.
  get bookmarks(): readonly ParsedBookmark[] {
    return this.listedBookmarks
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
    this.elisionCache.clear()
    return this.refresh()
  }

  placeBookmark(name: string, commitId: string): void {
    const current = this.current
    if (!current) {
      return
    }
    const placed = moveLocalBookmark(
      current.commits,
      this.listedBookmarks,
      name,
      commitId,
      current.hasRemotes,
    )
    this.viewGeneration += 1
    this.listedBookmarks = placed.bookmarks
    this.current = {
      ...current,
      commits: placed.commits,
      hasUnpushed: placed.hasUnpushed,
    }
    this.emit()
  }

  setForge(forge: ForgeState | null, requests: readonly RequestBadge[]): void {
    this.forge = forge
    this.requests = withStackInfo(requests)
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
    if (this.tail) {
      this.opEventDuringLoad = true
      return
    }
    try {
      const [head] = await this.repo.operations(1)
      if (head && head.id !== this.lastOperationId) {
        await this.refresh()
      }
    } catch (error: unknown) {
      this.logger.warn(`operation check failed: ${errorMessage(error)}`)
    }
  }

  // Resolves once any in-flight refresh has finished, without starting a new one.
  async settled(): Promise<void> {
    while (this.tail) {
      await this.tail
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
    const generation = this.viewGeneration
    this.opEventDuringLoad = false
    try {
      if (this.isDirty) {
        this.isDirty = false
        await this.repo.snapshot()
      }
      if (this.snapshotOtherWorkspaces) {
        await this.snapshotOthers()
      }
      this.lastError = null
      await this.buildState(generation)
    } catch (error: unknown) {
      this.lastError = errorMessage(error)
      this.logger.error(`refresh failed: ${this.lastError}`)
      this.emit()
      return
    }
    if (generation !== this.viewGeneration) {
      this.emit()
    }
    await this.noteExternalOperation()
  }

  private async buildState(generation: number): Promise<void> {
    const revset = graphRevset(this.filter, this.depth)
    const loaded = await this.loadRevisionData(revset)
    if (generation !== this.viewGeneration) {
      return
    }
    const bookmarks = loaded.bookmarks.filter((row) => row.remote !== 'git')
    const commits =
      loaded.remotes.length > 0
        ? markNeverPushed(loaded.logged, remoteBookmarkNames(bookmarks))
        : loaded.logged
    const workingCopyFiles = await this.workingCopyFiles(commits)
    const shared = sharedGraph(loaded, workingCopyFiles)
    const first = graphFromAncestors(commits, (parent) => this.elisionCache.get(revset, parent))
    const trunkId = loaded.trunk.commitId ?? undefined
    if (
      !this.showGraph(generation, this.assemble(commits, first.nodes, trunkId, shared), bookmarks)
    ) {
      return
    }
    if (first.missing.length === 0) {
      return
    }
    const nodes = await this.resolveMissingParents(commits, revset, first.missing)
    this.showGraph(generation, this.assemble(commits, nodes, trunkId, shared), bookmarks)
  }

  private async loadRevisionData(revset: string): Promise<LoadedRepo> {
    const operationsPromise = this.repo.operations(UNDO_HISTORY_LIMIT).then((operations) => {
      this.lastOperationId = operations[0]?.id ?? null
      return operations
    })
    const [logged, trunk, operations, workspaces, remotes, listed, currentBookmarks] =
      await Promise.all([
        this.repo.log(revset),
        this.repo.trunk(),
        operationsPromise,
        this.repo.workspaces(),
        this.repo.remotes(),
        this.repo.bookmarkList({ withTrunk: false }),
        this.repo.bookmarkNames(CURRENT_BOOKMARKS_REVSET),
      ])
    return { logged, trunk, operations, workspaces, remotes, bookmarks: listed, currentBookmarks }
  }

  private workingCopyFiles(commits: readonly Commit[]): Promise<ChangedFile[]> {
    const workingCopy = commits.find((commit) => commit.isWorkingCopy)
    if (!workingCopy) {
      return Promise.resolve([])
    }
    return this.repo.files(workingCopy.commitId, this.showLineStats)
  }

  private async resolveMissingParents(
    commits: readonly Commit[],
    revset: string,
    missing: readonly string[],
  ): Promise<GraphNodeInput[]> {
    const found = new Map<string, readonly string[]>()
    await Promise.all(
      missing.map(async (parent) => {
        try {
          const ancestors = await this.repo.commitIds(`heads(::${parent} & (${revset}))`)
          this.elisionCache.remember(revset, parent, ancestors)
          found.set(parent, ancestors)
        } catch {
          found.set(parent, [])
        }
      }),
    )
    return graphFromAncestors(commits, (parent) => {
      return found.get(parent) ?? this.elisionCache.get(revset, parent)
    }).nodes
  }

  private assemble(
    commits: readonly Commit[],
    nodes: readonly GraphNodeInput[],
    trunkId: string | undefined,
    shared: SharedGraph,
  ): GraphState {
    const rows = layoutGraph(nodes)
    const views = commits.map((commit, index) => toCommitView(commit, rows[index], trunkId))
    return {
      repoId: this.root,
      commits: this.attachRequests(views),
      workingCopyFiles: shared.workingCopyFiles,
      workspaces: shared.workspaces,
      filter: this.filter,
      depth: this.depth,
      hasRemotes: shared.hasRemotes,
      hasUnpushed: shared.hasRemotes && hasUnsyncedBookmarks(commits),
      canUndo: shared.head !== undefined && !NETWORK_OPERATION.test(shared.head.description),
      canRedo: canRedo(shared.operations.map((op) => op.description)),
      currentBookmarks: shared.currentBookmarks,
      trunkName: shared.trunkName,
      forge: this.forge,
    }
  }

  private showGraph(
    generation: number,
    state: GraphState,
    bookmarks: readonly ParsedBookmark[],
  ): boolean {
    if (generation !== this.viewGeneration) {
      return false
    }
    this.listedBookmarks = [...bookmarks]
    this.current = state
    this.emit()
    return true
  }

  private async noteExternalOperation(): Promise<void> {
    if (!this.opEventDuringLoad) {
      return
    }
    this.opEventDuringLoad = false
    try {
      const [head] = await this.repo.operations(1)
      if (head && head.id !== this.lastOperationId) {
        this.isRefreshQueued = true
      }
    } catch (error: unknown) {
      this.logger.warn(`operation check failed: ${errorMessage(error)}`)
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

interface LoadedRepo {
  logged: Commit[]
  trunk: TrunkRef
  operations: Operation[]
  workspaces: Workspace[]
  remotes: Remote[]
  bookmarks: ParsedBookmark[]
  currentBookmarks: string[]
}

interface SharedGraph {
  workingCopyFiles: ChangedFile[]
  workspaces: Workspace[]
  hasRemotes: boolean
  head: Operation | undefined
  operations: Operation[]
  currentBookmarks: string[]
  trunkName: string | null
}

function sharedGraph(loaded: LoadedRepo, workingCopyFiles: ChangedFile[]): SharedGraph {
  return {
    workingCopyFiles,
    workspaces: loaded.workspaces,
    hasRemotes: loaded.remotes.length > 0,
    head: loaded.operations[0],
    operations: loaded.operations,
    currentBookmarks: loaded.currentBookmarks,
    trunkName: loaded.trunk.bookmark,
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

function remoteBookmarkNames(rows: readonly ParsedBookmark[]): Set<string> {
  return new Set(rows.filter((row) => row.remote !== null).map((row) => row.name))
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
