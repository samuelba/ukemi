import { layoutGraph } from '../../shared/graphLayout'
import type { ChangedFile, Commit, GraphFilter, HistoryDepth } from '../../shared/model'
import type { CommitView, ForgeState, GraphState, RequestBadge } from '../../shared/protocol'
import { buildGraphNodes } from '../graph/buildGraph'
import { JjRepo } from '../jj/repo'
import { graphRevset } from '../jj/revsets'
import type { Logger } from '../util/logger'
import { errorMessage } from '../util/logger'

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
  private running: Promise<void> | null = null
  private isRefreshQueued = false
  private requests: RequestBadge[] = []
  private forge: ForgeState | null = null
  private readonly fileCache = new Map<string, ChangedFile[]>()
  private readonly listeners = new Set<ChangeListener>()

  constructor(
    readonly repo: JjRepo,
    private readonly logger: Logger,
    options: { depth?: HistoryDepth } = {},
  ) {
    this.depth = options.depth ?? this.depth
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

  setView(filter: GraphFilter, depth: HistoryDepth): Promise<void> {
    this.filter = filter
    this.depth = depth
    return this.refresh()
  }

  setForge(forge: ForgeState | null, requests: readonly RequestBadge[]): void {
    this.forge = forge
    this.requests = [...requests]
    if (this.current) {
      this.current = { ...this.current, forge, commits: this.attachRequests(this.current.commits) }
      this.emit()
    }
  }

  findCommit(commitId: string): CommitView | undefined {
    return this.current?.commits.find((c) => c.commitId === commitId)
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
    if (this.running) {
      this.isRefreshQueued = true
      return this.running
    }
    this.running = this.load().finally(() => {
      this.running = null
      if (this.isRefreshQueued) {
        this.isRefreshQueued = false
        void this.refresh()
      }
    })
    return this.running
  }

  private async load(): Promise<void> {
    try {
      if (this.isDirty) {
        this.isDirty = false
        await this.repo.snapshot()
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
    const [commits, trunkIds, operations, workspaces, remotes, trunkName] = await Promise.all([
      this.repo.log(revset),
      this.repo.commitIds('present(trunk())'),
      this.repo.operations(1),
      this.repo.workspaces(),
      this.repo.remotes(),
      this.repo.trunkBookmark(),
    ])
    const nodes = await buildGraphNodes(commits, (parent) =>
      this.repo.commitIds(`heads(::${parent} & (${revset}))`),
    )
    const rows = layoutGraph(nodes)
    const trunkId = trunkIds[0]
    const workingCopy = commits.find((c) => c.isWorkingCopy)
    const workingCopyFiles = workingCopy ? await this.repo.files(workingCopy.commitId) : []
    const head = operations[0]
    this.lastOperationId = head?.id ?? null

    const views: CommitView[] = commits.map((commit, index) => ({
      ...commit,
      row: rows[index] ?? {
        id: commit.commitId,
        column: 0,
        width: 1,
        incoming: [],
        outgoing: [],
        passThrough: [],
      },
      isTrunk: commit.commitId === trunkId,
      requests: [],
    }))

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
      trunkName,
      forge: this.forge,
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
    const cached = this.fileCache.get(commitId)
    if (cached) {
      return cached
    }
    const files = await this.repo.files(commitId)
    if (this.fileCache.size >= FILE_CACHE_LIMIT) {
      const oldest = this.fileCache.keys().next().value
      if (oldest !== undefined) {
        this.fileCache.delete(oldest)
      }
    }
    this.fileCache.set(commitId, files)
    return files
  }
}

function hasUnsyncedBookmarks(commits: readonly Commit[]): boolean {
  return commits.some((c) => c.localBookmarks.some((b) => !b.synced))
}
