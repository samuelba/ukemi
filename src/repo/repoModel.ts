import { resolve } from 'node:path'
import { layoutGraph, type GraphNodeInput } from '../../shared/graphLayout'
import type {
  BookmarkTracking,
  ChangedFile,
  Commit,
  EvolutionEntry,
  GraphFilter,
  HistoryDepth,
  Operation,
  Remote,
  Workspace,
} from '../../shared/model'
import type { CommitView, ForgeState, GraphState, RequestBadge } from '../../shared/protocol'
import { withStackInfo } from '../../shared/stack'
import { graphFromAncestors, hiddenParents, MAX_ELIDED_LOOKUPS } from '../graph/buildGraph'
import { ElisionCache } from '../graph/elisionCache'
import type { ParsedBookmark } from '../jj/parse'
import { GRAPH_PAGE_SIZE, JjRepo, type TrunkRef } from '../jj/repo'
import {
  changeRevision,
  CURRENT_BOOKMARKS_REVSET,
  customGraphRevset,
  elisionLookupRevset,
  graphRevset,
  type ChangeRef,
} from '../jj/revsets'
import type { Logger } from '../util/logger'
import { mapLimited } from '../util/mapLimited'
import { errorMessage } from '../util/logger'
import {
  changesOf,
  hasUnsyncedBookmarks,
  markNeverPushed,
  remoteBookmarkNames,
  toCommitView,
} from './commitViews'
import { placeBookmark as moveLocalBookmark } from './placeBookmark'
import {
  lookupTarget,
  onlySnapshotsSince,
  snapshotPageRevset,
  snapshotsKeepMembership,
  type GraphView,
  type LookupTarget,
} from './refreshRevsets'
import { resolveSelectedCommit } from './selection'
import { canRedo, UNDO_HISTORY_LIMIT } from './undoState'

const FILE_CACHE_LIMIT = 200
const NETWORK_OPERATION = /^(fetch from git remote|push .*to git remote)/

export type ChangeListener = () => void

const ELISION_LOOKUPS_AT_ONCE = 4
// Reading the page from the shown commits after a snapshot pays off only where the revset is
// slow, as when it makes jj read every commit of a large repository.
const SNAPSHOT_PAGE_AFTER_MS = 300

export class RepoModel {
  private filter: GraphFilter = 'recent'
  private depth: HistoryDepth = '7d'
  private revset: string | null = null
  private readonly pageSize: number
  // How many commits the graph loads. It grows by a page each time the view asks for more, and
  // starts over when the view changes.
  private limit: number
  private droppedParents = 0
  private readonly snapshotPageAfterMs: number
  // How long the last load of the page from the graph's revset took.
  private fullPageMs: number | null = null
  private current: GraphState | null = null
  // The commits of the graph before the current one, so ids that a view sent just before a
  // refresh still find their change.
  private previousChanges = new Map<string, ChangeRef>()
  private lastError: string | null = null
  private isDirty = true
  private mustReload = false
  private lastOperationId: string | null = null
  private loadedOperations: readonly Operation[] = []
  private loadedRemotes: Remote[] | null = null
  private tail: Promise<void> | null = null
  private isRefreshQueued = false
  private opEventDuringLoad = false
  private operationCheck: Promise<void> | null = null
  private opEventDuringCheck = false
  private viewGeneration = 0
  private readonly elisionCache = new ElisionCache()
  private requests: RequestBadge[] = []
  private forge: ForgeState | null = null
  private snapshotOtherWorkspaces = false
  private showLineStats = false
  private readonly fileCache = new Map<string, ChangedFile[]>()
  private readonly evolutionCache = new Map<string, Promise<EvolutionEntry[]>>()
  private evolutionOperation: string | null = null
  private readonly listeners = new Set<ChangeListener>()
  private listedBookmarks: ParsedBookmark[] = []

  constructor(
    readonly repo: JjRepo,
    private readonly logger: Logger,
    options: {
      depth?: HistoryDepth
      filter?: GraphFilter
      revset?: string | null
      snapshotOtherWorkspaces?: boolean
      showLineStats?: boolean
      pageSize?: number
      snapshotPageAfterMs?: number
    } = {},
  ) {
    this.snapshotPageAfterMs = options.snapshotPageAfterMs ?? SNAPSHOT_PAGE_AFTER_MS
    this.pageSize = options.pageSize ?? GRAPH_PAGE_SIZE
    this.limit = this.pageSize
    this.depth = options.depth ?? this.depth
    this.filter = options.filter ?? this.filter
    this.revset = options.revset ?? null
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

  // The newest operations, newest first, as of the shown graph.
  get operations(): readonly Operation[] {
    return this.loadedOperations
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

  setView(filter: GraphFilter, depth: HistoryDepth, revset: string | null = null): Promise<void> {
    this.filter = filter
    this.depth = depth
    this.revset = revset
    this.limit = this.pageSize
    this.elisionCache.clear()
    return this.refresh()
  }

  // Loads the next page of a truncated graph. A refresh keeps the larger limit, so an operation
  // does not collapse history the user scrolled to.
  loadMore(): Promise<void> {
    if (!this.current?.isTruncated) {
      return Promise.resolve()
    }
    this.limit += this.pageSize
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

  // The remotes the last refresh read, so other services need not ask jj again.
  get remotes(): readonly Remote[] | null {
    return this.loadedRemotes
  }

  findCommit(commitId: string): CommitView | undefined {
    return this.current?.commits.find((c) => c.commitId === commitId)
  }

  // The commit a view or menu named, or the commit its change has now if a snapshot or another
  // command rewrote it since.
  latestCommit(commitId: string): CommitView | undefined {
    const found = this.findCommit(commitId)
    if (found) {
      return found
    }
    const known = this.previousChanges.get(commitId)
    if (!known || known.isDivergent) {
      return undefined
    }
    const same = this.current?.commits.filter((c) => c.changeId === known.changeId) ?? []
    return same.length === 1 ? same[0] : undefined
  }

  // The revision to pass to a jj command for a commit a view named. See changeRevision.
  revisionFor(commitId: string): string {
    const known = this.findCommit(commitId) ?? this.previousChanges.get(commitId)
    return known ? changeRevision(known) : commitId
  }

  // A change by its commit id, also when the graph does not show it, as for a file's history.
  async loadCommit(commitId: string): Promise<CommitView | null> {
    const shown = this.findCommit(commitId)
    if (shown) {
      return shown
    }
    const [commit] = await this.repo.log(commitId, 1)
    return commit ? toCommitView(commit, undefined, undefined) : null
  }

  commitFor(commitId: string, changeId: string): CommitView | null {
    return resolveSelectedCommit(
      this.current?.commits ?? [],
      { repoId: this.root, commitId, changeId },
      this.root,
    )
  }

  // One operation touches several files under op_heads, so the events of a burst share one check.
  refreshIfOperationChanged(): Promise<void> {
    if (this.tail) {
      this.opEventDuringLoad = true
      return Promise.resolve()
    }
    if (this.operationCheck) {
      this.opEventDuringCheck = true
      return this.operationCheck
    }
    const check = this.checkOperation().finally(() => {
      if (this.operationCheck === check) {
        this.operationCheck = null
      }
    })
    this.operationCheck = check
    return check
  }

  // An event that lands while the head is read may be newer than it, so that read is repeated.
  private async checkOperation(): Promise<void> {
    try {
      do {
        this.opEventDuringCheck = false
        const [head] = await this.repo.operations(1)
        if (head && head.id !== this.lastOperationId) {
          await this.refresh()
          return
        }
      } while (this.opEventDuringCheck)
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
    this.mustReload = true
    return this.request()
  }

  // Snapshots the working copy and reloads only when that recorded an operation, so a write that
  // changes nothing jj tracks (an ignored build output, a save without edits) costs no graph load.
  refreshWorkingCopy(): Promise<void> {
    this.isDirty = true
    return this.request()
  }

  private request(): Promise<void> {
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
    const reload = this.mustReload || !this.current || this.lastError !== null
    this.mustReload = false
    try {
      if (this.isDirty) {
        this.isDirty = false
        await this.repo.snapshot()
      }
      if (this.snapshotOtherWorkspaces) {
        await this.snapshotOthers()
      }
      // The undo history comes along, so a rebuild reads the operation log only once.
      const operations = await this.repo.operations(UNDO_HISTORY_LIMIT)
      const head = operations[0]?.id ?? null
      if (reload || head !== this.lastOperationId) {
        this.lastError = null
        await this.buildState(generation, head, operations)
      }
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

  // Every read sees the repository as of `head`, so the graph matches lastOperationId. A command
  // that lands meanwhile then shows as a new operation, and the next check loads it.
  private async buildState(
    generation: number,
    head: string | null,
    operations: readonly Operation[],
  ): Promise<void> {
    const reader = head === null ? this.repo : this.repo.atOperation(head)
    const revset =
      this.revset === null ? graphRevset(this.filter, this.depth) : customGraphRevset(this.revset)
    if (
      snapshotsKeepMembership(this.view) &&
      onlySnapshotsSince(operations, this.lastOperationId)
    ) {
      this.elisionCache.carryForward(this.lastOperationId, head)
    }
    const snapshotPage = this.snapshotPage(operations, revset)
    const loaded = await this.loadRevisionData(reader, snapshotPage ?? revset, operations, {
      timesPage: snapshotPage === null,
    })
    if (generation !== this.viewGeneration) {
      return
    }
    const bookmarks = loaded.bookmarks.filter((row) => row.remote !== 'git')
    const commits =
      loaded.remotes.length > 0
        ? markNeverPushed(loaded.logged, remoteBookmarkNames(bookmarks))
        : loaded.logged
    const workingCopyFiles = await this.workingCopyFiles(reader, commits)
    const shared = sharedGraph(loaded, workingCopyFiles)
    const cutOff = loaded.isTruncated
      ? await this.cutOffParents(reader, revset, commits)
      : new Set<string>()
    // Entries from an earlier operation draw provisional edges, so the graph does not flash
    // disconnected nodes, and are looked up again below.
    const unresolved: string[] = []
    const first = graphFromAncestors(
      commits,
      (parent) => {
        const hit = this.elisionCache.lookup(revset, parent, head)
        if (!hit?.fresh) {
          unresolved.push(parent)
        }
        return hit?.ancestors
      },
      cutOff,
    )
    this.noteDroppedParents(first.dropped)
    const trunkId = loaded.trunk.commitId ?? undefined
    if (
      !this.showGraph(generation, this.assemble(commits, first.nodes, trunkId, shared), bookmarks)
    ) {
      return
    }
    if (unresolved.length === 0) {
      return
    }
    const nodes = await this.resolveMissingParents(reader, commits, revset, head, unresolved, {
      cutOff,
      lookup: lookupTarget(revset, commits, loaded.isTruncated),
    })
    this.showGraph(generation, this.assemble(commits, nodes, trunkId, shared), bookmarks)
  }

  // In a truncated graph, the parents that the revset matches lie past its end. One query finds
  // them, so each draws a plain edge off the bottom instead of costing an elision lookup that
  // could only come back empty.
  private async cutOffParents(
    reader: JjRepo,
    revset: string,
    commits: readonly Commit[],
  ): Promise<Set<string>> {
    const hidden = hiddenParents(commits)
    if (hidden.length === 0) {
      return new Set()
    }
    try {
      return new Set(await reader.commitIds(`(${revset}) & (${hidden.join(' | ')})`))
    } catch (error: unknown) {
      this.logger.warn(`graph: finding the parents past the end failed: ${errorMessage(error)}`)
      return new Set()
    }
  }

  private get view(): GraphView {
    return { filter: this.filter, depth: this.depth, revset: this.revset }
  }

  // The revset to read the page with after snapshots only, or null to read it from `revset`.
  // See snapshotPageRevset.
  private snapshotPage(operations: readonly Operation[], revset: string): string | null {
    if (this.fullPageMs === null || this.fullPageMs < this.snapshotPageAfterMs) {
      return null
    }
    const input = {
      view: this.view,
      shown: this.current,
      shownOperation: this.lastOperationId,
      operations,
    }
    return snapshotPageRevset(input, revset)
  }

  // Logged when the count changes, so a refresh of the same graph does not repeat it.
  private noteDroppedParents(dropped: number): void {
    if (dropped > 0 && dropped !== this.droppedParents) {
      this.logger.warn(
        `graph: ${dropped} hidden parents are past the lookup limit of ${MAX_ELIDED_LOOKUPS} and draw no edge`,
      )
    }
    this.droppedParents = dropped
  }

  private async loadRevisionData(
    reader: JjRepo,
    pageRevset: string,
    operations: readonly Operation[],
    { timesPage }: { timesPage: boolean },
  ): Promise<LoadedRepo> {
    this.lastOperationId = operations[0]?.id ?? null
    this.loadedOperations = operations
    const started = Date.now()
    const pageLoad = reader.logPage(pageRevset, this.limit).then((page) => {
      if (timesPage) {
        this.fullPageMs = Date.now() - started
      }
      return page
    })
    const [page, trunk, workspaces, remotes, listed, currentBookmarks, tracking] =
      await Promise.all([
        pageLoad,
        reader.trunk(),
        reader.workspaces(),
        reader.remotes(),
        reader.bookmarkList({ withTrunk: false }),
        reader.bookmarkNames(CURRENT_BOOKMARKS_REVSET),
        reader.bookmarkTracking(`@ | ${CURRENT_BOOKMARKS_REVSET}`),
      ])
    this.loadedRemotes = remotes
    return {
      logged: page.commits,
      isTruncated: page.isTruncated,
      trunk,
      operations: [...operations],
      workspaces,
      remotes,
      bookmarks: listed,
      currentBookmarks,
      tracking,
    }
  }

  private workingCopyFiles(reader: JjRepo, commits: readonly Commit[]): Promise<ChangedFile[]> {
    const workingCopy = commits.find((commit) => commit.isWorkingCopy)
    if (!workingCopy) {
      return Promise.resolve([])
    }
    return reader.files(workingCopy.commitId, this.showLineStats)
  }

  private async resolveMissingParents(
    reader: JjRepo,
    commits: readonly Commit[],
    revset: string,
    head: string | null,
    missing: readonly string[],
    { cutOff, lookup }: { cutOff: ReadonlySet<string>; lookup: LookupTarget },
  ): Promise<GraphNodeInput[]> {
    const found = new Map<string, readonly string[]>()
    const answer = (parent: string, ancestors: readonly string[]): void => {
      this.elisionCache.remember(revset, parent, head, ancestors)
      found.set(parent, ancestors)
    }
    const batched = await this.batchLookups(reader, missing, lookup)
    batched.forEach((ancestors, parent) => answer(parent, ancestors))
    const remaining = missing.filter((parent) => !batched.has(parent))
    // Each lookup is a jj process that loads the repository, so a cold graph with many elided
    // parents would otherwise start dozens at once.
    await mapLimited(remaining, ELISION_LOOKUPS_AT_ONCE, async (parent) => {
      try {
        answer(parent, await reader.commitIds(elisionLookupRevset(parent, lookup.revset)))
      } catch (error: unknown) {
        // Nothing is stored, so a provisional edge from the cache stays and the next refresh
        // tries again.
        this.logger.warn(
          `graph: looking up the ancestors of ${parent} failed: ${errorMessage(error)}`,
        )
      }
    })
    return graphFromAncestors(
      commits,
      (parent) => found.get(parent) ?? this.elisionCache.lookup(revset, parent, head)?.ancestors,
      cutOff,
    ).nodes
  }

  // One jj process answers every lookup, when jj can evaluate revsets in templates. That only
  // pays when the lookups search the shown commits: with the graph's revset, jj would evaluate
  // it once for each parent in a row. A failed batch answers nothing, so each parent falls back
  // to a lookup of its own.
  private async batchLookups(
    reader: JjRepo,
    missing: readonly string[],
    lookup: LookupTarget,
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    if (!lookup.listsShown || missing.length < 2 || !(await reader.canBatchElisionLookups())) {
      return new Map()
    }
    try {
      return await reader.elidedHeads(missing, lookup.revset)
    } catch (error: unknown) {
      this.logger.warn(`graph: the batched elision lookup failed: ${errorMessage(error)}`)
      return new Map()
    }
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
      revset: this.revset,
      isTruncated: shared.isTruncated,
      hasRemotes: shared.hasRemotes,
      hasUnpushed: shared.hasRemotes && hasUnsyncedBookmarks(commits),
      canUndo: shared.head !== undefined && !NETWORK_OPERATION.test(shared.head.description),
      canRedo: canRedo(shared.operations.map((op) => op.description)),
      currentBookmarks: shared.currentBookmarks,
      tracking: shared.tracking,
      operationId: shared.head?.id ?? null,
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
    this.previousChanges = changesOf(this.current)
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
        this.mustReload = true
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

  // Nothing in an evolution changes without a new operation, so refreshes and overlapping callers share one load.
  evolutionFor(commitId: string): Promise<EvolutionEntry[]> {
    if (
      this.evolutionOperation !== this.lastOperationId ||
      this.evolutionCache.size >= FILE_CACHE_LIMIT
    ) {
      this.evolutionCache.clear()
      this.evolutionOperation = this.lastOperationId
    }
    const cached = this.evolutionCache.get(commitId)
    if (cached) {
      return cached
    }
    const loading = this.repo.evolution(commitId)
    this.evolutionCache.set(commitId, loading)
    loading.catch(() => {
      if (this.evolutionCache.get(commitId) === loading) {
        this.evolutionCache.delete(commitId)
      }
    })
    return loading
  }
}

interface LoadedRepo {
  logged: Commit[]
  isTruncated: boolean
  trunk: TrunkRef
  operations: Operation[]
  workspaces: Workspace[]
  remotes: Remote[]
  bookmarks: ParsedBookmark[]
  currentBookmarks: string[]
  tracking: BookmarkTracking[]
}

interface SharedGraph {
  isTruncated: boolean
  workingCopyFiles: ChangedFile[]
  workspaces: Workspace[]
  hasRemotes: boolean
  head: Operation | undefined
  operations: Operation[]
  currentBookmarks: string[]
  tracking: BookmarkTracking[]
  trunkName: string | null
}

function sharedGraph(loaded: LoadedRepo, workingCopyFiles: ChangedFile[]): SharedGraph {
  return {
    isTruncated: loaded.isTruncated,
    workingCopyFiles,
    workspaces: loaded.workspaces,
    hasRemotes: loaded.remotes.length > 0,
    head: loaded.operations[0],
    operations: loaded.operations,
    currentBookmarks: loaded.currentBookmarks,
    tracking: loaded.tracking,
    trunkName: loaded.trunk.bookmark,
  }
}
