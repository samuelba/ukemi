import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type {
  AnnotatedLine,
  BookmarkTracking,
  ChangedFile,
  Commit,
  EvolutionEntry,
  Operation,
  Remote,
  Workspace,
} from '../../shared/model'
import { hostSpawn } from '../util/hostProcess'
import { errorMessage } from '../util/logger'
import { SerialQueue } from '../util/serialQueue'
import {
  parseAnnotation,
  parseBookmarks,
  isVersionAtLeast,
  parseCommitIds,
  parseDiffFiles,
  parseElidedHeads,
  parseEvolution,
  parseFiles,
  parseLog,
  parseOperations,
  parseRemotes,
  parseTracking,
  parseWorkspaces,
  type JjVersion,
} from './parse'
import { bookmarkRevision, commitSetRevset, exactBookmark, rootFileset } from './revsets'
import { JjError, JjRunner, NETWORK_TIMEOUT_MS, type RunOptions, type RunResult } from './runner'
import { jjString } from './templates'
import {
  ANNOTATE_TEMPLATE,
  BOOKMARK_LIST_GRAPH_TEMPLATE,
  BOOKMARK_LIST_TEMPLATE,
  BOOKMARK_TRACKING_TEMPLATE,
  COMMIT_ID_TEMPLATE,
  DIFF_FILES_TEMPLATE,
  elidedHeadsTemplate,
  EVOLOG_TEMPLATE,
  FILES_STATS_TEMPLATE,
  FILES_TEMPLATE,
  LOG_TEMPLATE,
  OP_LOG_TEMPLATE,
  PUSHED_BOOKMARK_TEMPLATE,
  TRUNK_TEMPLATE,
  WORKSPACE_TEMPLATE,
} from './templates'

export const MAX_LOG_ENTRIES = 2000
// The graph loads this many commits at first, and this many more each time it reaches the end.
export const GRAPH_PAGE_SIZE = 500
export const MAX_EVOLUTION_ENTRIES = 200
// The first jj whose templates can evaluate a revset, which elidedHeads needs.
export const TEMPLATE_REVSET_VERSION: JjVersion = { major: 0, minor: 47, patch: 0 }

export interface LogPage {
  commits: Commit[]
  isTruncated: boolean
}
export const MAX_FILE_HISTORY_ENTRIES = 500

export type SplitDirection = 'below' | 'above'
export type RebaseMode = 'source' | 'revision' | 'branch'
export type Placement = 'onto' | 'after' | 'before'

export interface TrunkRef {
  commitId: string | null
  bookmark: string | null
}

const PLACEMENT_FLAGS: Record<Placement, string> = {
  onto: '--onto',
  after: '--insert-after',
  before: '--insert-before',
}

const REBASE_MODE_FLAGS: Record<RebaseMode, string> = {
  source: '-s',
  revision: '-r',
  branch: '-b',
}

export class JjRepo {
  private readonly mutations = new SerialQueue()

  constructor(
    readonly root: string,
    private readonly runner: JjRunner,
    // Reads see the repository as of this operation. See atOperation.
    private readonly operationId: string | null = null,
  ) {}

  // A view for reads that must agree with each other, like the parallel reads of one refresh:
  // without it, a command that lands between them gives some reads the new state and others the
  // old one. It cannot run commands.
  atOperation(operationId: string): JjRepo {
    return new JjRepo(this.root, this.runner, operationId)
  }

  get isColocated(): boolean {
    return existsSync(join(this.root, '.git'))
  }

  get hasPendingMutations(): boolean {
    return this.mutations.size > 0
  }

  private read(args: readonly string[]): Promise<RunResult> {
    const pinned = this.operationId === null ? args : [...args, `--at-op=${this.operationId}`]
    return this.runner.run({ cwd: this.root, args: pinned, ignoreWorkingCopy: true })
  }

  private mutate(
    args: readonly string[],
    options: Pick<RunOptions, 'stdin' | 'timeoutMs' | 'env' | 'background'> = {},
  ) {
    if (this.operationId !== null) {
      throw new Error('jj commands cannot run at an old operation')
    }
    return this.mutations.run(() => this.runner.run({ cwd: this.root, args, ...options }))
  }

  // Why jj cannot evaluate the revset, or null when it can.
  async revsetError(revset: string): Promise<string | null> {
    try {
      await this.read(['log', '--no-graph', '--limit=1', '-r', revset, '-T', '""'])
      return null
    } catch (error: unknown) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  snapshot(): Promise<RunResult> {
    return this.mutate(['util', 'snapshot'], { background: true })
  }

  async log(revset: string, limit = MAX_LOG_ENTRIES): Promise<Commit[]> {
    const { stdout } = await this.read([
      'log',
      '--no-graph',
      `--limit=${limit}`,
      '-r',
      revset,
      '-T',
      LOG_TEMPLATE,
    ])
    return parseLog(stdout)
  }

  // The first `limit` commits of the revset. One more is asked for, so a revset that holds more
  // says so instead of ending silently at the limit.
  async logPage(revset: string, limit: number): Promise<LogPage> {
    const commits = await this.log(revset, limit + 1)
    return { commits: commits.slice(0, limit), isTruncated: commits.length > limit }
  }

  async commitIds(revset: string): Promise<string[]> {
    const { stdout } = await this.read([
      'log',
      '--no-graph',
      '-r',
      revset,
      '-T',
      COMMIT_ID_TEMPLATE,
    ])
    return parseCommitIds(stdout)
  }

  // Whether elidedHeads works with this jj.
  async canBatchElisionLookups(): Promise<boolean> {
    const version = await this.runner.version()
    return version !== null && isVersionAtLeast(version, TEMPLATE_REVSET_VERSION)
  }

  // heads(::parent & (target)) for each parent, from one jj process instead of one each. A
  // parent missing from the result was not answered. Needs TEMPLATE_REVSET_VERSION.
  async elidedHeads(parentIds: readonly string[], target: string): Promise<Map<string, string[]>> {
    const { stdout } = await this.read([
      'log',
      '--no-graph',
      '-r',
      commitSetRevset(parentIds),
      '-T',
      elidedHeadsTemplate(target),
    ])
    return parseElidedHeads(stdout)
  }

  async files(commitId: string, withStats = false): Promise<ChangedFile[]> {
    const template = withStats ? FILES_STATS_TEMPLATE : FILES_TEMPLATE
    const { stdout } = await this.read(['log', '--no-graph', '-r', commitId, '-T', template])
    return parseFiles(stdout)
  }

  async evolution(revision: string): Promise<EvolutionEntry[]> {
    const { stdout } = await this.read([
      'evolog',
      '--no-graph',
      `--limit=${MAX_EVOLUTION_ENTRIES}`,
      '-r',
      revision,
      '-T',
      EVOLOG_TEMPLATE,
    ])
    return parseEvolution(stdout)
  }

  async diffFiles(fromCommitId: string, toCommitId: string): Promise<ChangedFile[]> {
    const { stdout } = await this.read([
      'diff',
      '--from',
      fromCommitId,
      '--to',
      toCommitId,
      '-T',
      DIFF_FILES_TEMPLATE,
    ])
    return parseDiffFiles(stdout)
  }

  async interdiff(fromCommitId: string, toCommitId: string): Promise<string> {
    const { stdout } = await this.read([
      'interdiff',
      '--from',
      fromCommitId,
      '--to',
      toCommitId,
      '--git',
    ])
    return stdout
  }

  // What one change does, as a git patch.
  async diffGit(commitId: string): Promise<string> {
    const { stdout } = await this.read(['diff', '-r', commitId, '--git'])
    return stdout
  }

  async diffStat(commitId: string): Promise<string> {
    const { stdout } = await this.read(['diff', '-r', commitId, '--stat'])
    return stdout
  }

  // The descriptions of the nearest ancestors, newest first, without empty ones.
  async ancestorDescriptions(commitId: string, limit: number): Promise<string[]> {
    const { stdout } = await this.read([
      'log',
      '--no-graph',
      '-r',
      `::${commitId}- ~ root()`,
      `--limit=${limit}`,
      '-T',
      'description ++ "\\0"',
    ])
    return stdout
      .split('\0')
      .map((description) => description.trim())
      .filter((description) => description !== '')
  }

  async workspaces(): Promise<Workspace[]> {
    const { stdout } = await this.read(['workspace', 'list', '-T', WORKSPACE_TEMPLATE])
    return parseWorkspaces(stdout)
  }

  async remotes(): Promise<Remote[]> {
    const { stdout } = await this.read(['git', 'remote', 'list'])
    return parseRemotes(stdout)
  }

  async bookmarkNames(revset: string): Promise<string[]> {
    const { stdout } = await this.read([
      'log',
      '--no-graph',
      '-r',
      revset,
      '-T',
      'local_bookmarks.map(|b| b.name() ++ "\\n").join("")',
    ])
    return stdout.split('\n').filter((line) => line.length > 0)
  }

  async bookmarkList(options: { withTrunk?: boolean } = {}) {
    const template =
      options.withTrunk === false ? BOOKMARK_LIST_GRAPH_TEMPLATE : BOOKMARK_LIST_TEMPLATE
    const { stdout } = await this.read(['bookmark', 'list', '--all-remotes', '-T', template])
    return parseBookmarks(stdout)
  }

  // The remote refs of the bookmarks that point into the revset.
  async bookmarkTracking(revset: string): Promise<BookmarkTracking[]> {
    const { stdout } = await this.read([
      'bookmark',
      'list',
      '--all-remotes',
      '-r',
      revset,
      '-T',
      BOOKMARK_TRACKING_TEMPLATE,
    ])
    return parseTracking(stdout)
  }

  async pushedBookmarkNames(): Promise<Set<string>> {
    const { stdout } = await this.read([
      'bookmark',
      'list',
      '--all-remotes',
      '-T',
      PUSHED_BOOKMARK_TEMPLATE,
    ])
    return new Set(stdout.split('\n').filter((line) => line.length > 0))
  }

  // The local bookmarks, split by whether a remote has a branch of that name yet.
  async localBookmarks(): Promise<{ published: string[]; unpublished: string[] }> {
    const [rows, pushed] = await Promise.all([this.bookmarkList(), this.pushedBookmarkNames()])
    const local = rows.filter((row) => row.remote === null && row.present).map((row) => row.name)
    return {
      published: local.filter((name) => pushed.has(name)),
      unpublished: local.filter((name) => !pushed.has(name)),
    }
  }

  // The change that last touched each line of the file, as of the revision.
  async annotate(revision: string, path: string): Promise<AnnotatedLine[]> {
    const { stdout } = await this.read([
      'file',
      'annotate',
      '-r',
      revision,
      '-T',
      ANNOTATE_TEMPLATE,
      '--',
      path,
    ])
    return parseAnnotation(stdout)
  }

  // The changes that touched the file, newest first. jj does not follow renames.
  fileHistory(path: string, limit = MAX_FILE_HISTORY_ENTRIES): Promise<Commit[]> {
    return this.log(`files(${rootFileset(path)})`, limit)
  }

  async operations(limit: number): Promise<Operation[]> {
    const { stdout } = await this.read([
      'op',
      'log',
      '--no-graph',
      `--limit=${limit}`,
      '-T',
      OP_LOG_TEMPLATE,
    ])
    return parseOperations(stdout)
  }

  async trunk(): Promise<TrunkRef> {
    const { stdout } = await this.read([
      'log',
      '--no-graph',
      '-r',
      'present(trunk())',
      '-T',
      TRUNK_TEMPLATE,
    ])
    return parseTrunk(stdout)
  }

  async trunkBookmark(): Promise<string | null> {
    return (await this.trunk()).bookmark
  }

  fileContent(commitId: string, path: string): Promise<Buffer> {
    return this.runner.runBytes({
      cwd: this.root,
      args: ['file', 'show', '-r', commitId, rootFileset(path)],
    })
  }

  newChange(parents: readonly string[], options: { insertBefore?: boolean } = {}) {
    if (options.insertBefore) {
      return this.mutate(['new', '--no-edit', ...parents.flatMap((p) => ['-B', p])])
    }
    return this.mutate(['new', ...parents])
  }

  edit(commitId: string, options: { ignoreImmutable?: boolean } = {}) {
    return this.mutate([
      'edit',
      commitId,
      ...(options.ignoreImmutable ? ['--ignore-immutable'] : []),
    ])
  }

  describe(commitId: string, message: string) {
    return this.mutate(['describe', commitId, '--stdin'], { stdin: message })
  }

  squashIntoParent(commitId: string, message: string) {
    return this.mutate(['squash', '-r', commitId, `--message=${message}`])
  }

  moveFiles(fromCommitId: string, intoCommitId: string, paths: readonly string[]) {
    return this.mutate([
      'squash',
      '--from',
      fromCommitId,
      '--into',
      intoCommitId,
      '--use-destination-message',
      ...paths.map(rootFileset),
    ])
  }

  // One queue entry, so no other command runs between the steps. The target is followed by its
  // commit id, since its change id can name several commits when the change is divergent.
  copyFiles(fromCommitId: string, intoCommitId: string, paths: readonly string[]) {
    return this.mutations.run(async () => {
      const [target] = await this.log(intoCommitId, 1)
      if (!target) {
        throw new Error(`Target change ${intoCommitId} not found`)
      }
      const restored = await this.rewriting(target, () =>
        this.restoreNow(fromCommitId, target.commitId, paths),
      )
      if (await this.diffHasAnyPath(restored, paths)) {
        return
      }
      const [after] = await this.log(restored, 1)
      // An empty descendant already has the source content, so restore is a no-op.
      // Move it beside the source, then the same restore becomes a real change.
      if (after?.isEmpty && (await this.isProperDescendant(restored, fromCommitId))) {
        const moved = await this.rewriting(after, () =>
          this.runNow([
            'rebase',
            REBASE_MODE_FLAGS.revision,
            restored,
            PLACEMENT_FLAGS.onto,
            `parents(${fromCommitId})`,
          ]),
        )
        await this.restoreNow(fromCommitId, moved, paths)
        return
      }
      throw new Error('Target already contains this file content')
    })
  }

  // Runs a command that rewrites `commit` and returns the commit id the change has afterwards.
  private async rewriting(
    commit: { commitId: string; changeId: string },
    run: () => Promise<unknown>,
  ): Promise<string> {
    const revset = `change_id(${commit.changeId})`
    const before = new Set(await this.commitIds(revset))
    await run()
    const after = await this.commitIds(revset)
    const rewritten = after.find((id) => !before.has(id))
    if (rewritten) {
      return rewritten
    }
    if (after.includes(commit.commitId)) {
      return commit.commitId
    }
    throw new Error(`Change ${commit.changeId} not found after the command`)
  }

  // Runs a mutation inside a queue entry that is already running.
  private runNow(args: readonly string[]) {
    return this.runner.run({ cwd: this.root, args })
  }

  private restoreNow(fromCommitId: string, intoCommitId: string, paths: readonly string[]) {
    return this.runNow([
      'restore',
      '--from',
      fromCommitId,
      '--into',
      intoCommitId,
      ...paths.map(rootFileset),
    ])
  }

  private async diffHasAnyPath(commitId: string, paths: readonly string[]) {
    const files = await this.files(commitId)
    return paths.some((path) =>
      files.some((file) => file.path === path || file.sourcePath === path),
    )
  }

  private async isProperDescendant(commitId: string, ancestorId: string) {
    const found = await this.log(`(${commitId} & descendants(${ancestorId})) ~ ${ancestorId}`, 1)
    return found.length > 0
  }

  splitFiles(commitId: string, paths: readonly string[], direction: SplitDirection) {
    return this.mutate([
      'split',
      '-r',
      commitId,
      '--message=',
      ...(direction === 'above' ? ['-A', commitId] : []),
      ...paths.map(rootFileset),
    ])
  }

  splitWithTool(commitId: string, toolConfig: readonly string[], message: string) {
    return this.mutate([
      ...toolConfig,
      'split',
      '-r',
      commitId,
      '--tool=ukemi-split',
      `--message=${message}`,
    ])
  }

  // Runs the configured diff tool on the commit's diff. For a merge, jj diffs against the merge
  // of the parents.
  async diffWithTool(commitId: string, paths: readonly string[], toolConfig: readonly string[]) {
    await this.read([
      ...toolConfig,
      'diff',
      '-r',
      commitId,
      '--tool=ukemi-split',
      ...paths.map(rootFileset),
    ])
  }

  // Rewrites the files in place. `--from root()` puts each file in `$right` even when it equals
  // the merge of the parents, as a conflicted file in a merge commit does, which `-r` would skip.
  writeFilesWithTool(commitId: string, paths: readonly string[], toolConfig: readonly string[]) {
    return this.mutate([
      ...toolConfig,
      'diffedit',
      '--from',
      'root()',
      '--to',
      commitId,
      '--tool=ukemi-split',
      ...paths.map(rootFileset),
    ])
  }

  // `:ours` takes side #1 and `:theirs` side #2. jj refuses conflicts with more than two sides.
  resolveWithBuiltin(commitId: string, path: string, tool: ':ours' | ':theirs') {
    return this.mutate(['resolve', '-r', commitId, `--tool=${tool}`, rootFileset(path)])
  }

  abandon(revset: string) {
    return this.mutate(['abandon', revset])
  }

  duplicate(revset: string, destination?: string, placement: Placement = 'onto') {
    return this.mutate([
      'duplicate',
      revset,
      ...(destination ? [PLACEMENT_FLAGS[placement], destination] : []),
    ])
  }

  // Inserts copies between two changes, which rebases `before` and its descendants onto them.
  duplicateBetween(revset: string, after: string, before: string) {
    return this.mutate(['duplicate', revset, '--insert-after', after, '--insert-before', before])
  }

  revert(commitId: string) {
    return this.mutate(['revert', '-r', commitId, '--onto', '@'])
  }

  rebase(source: string, destination: string, mode: RebaseMode, placement: Placement = 'onto') {
    return this.mutate([
      'rebase',
      REBASE_MODE_FLAGS[mode],
      source,
      PLACEMENT_FLAGS[placement],
      destination,
    ])
  }

  // Inserts the source between two changes, which rebases `before` onto it.
  rebaseBetween(source: string, mode: RebaseMode, after: string, before: string) {
    return this.mutate([
      'rebase',
      REBASE_MODE_FLAGS[mode],
      source,
      '--insert-after',
      after,
      '--insert-before',
      before,
    ])
  }

  restoreFiles(commitId: string, paths: readonly string[]) {
    return this.mutate(['restore', '--changes-in', commitId, ...paths.map(rootFileset)])
  }

  restoreVersion(fromCommitId: string, intoCommitId: string) {
    return this.mutate(['restore', '--from', fromCommitId, '--into', intoCommitId])
  }

  trackFiles(paths: readonly string[]) {
    return this.mutate(['file', 'track', ...paths.map(rootFileset)])
  }

  untrackFiles(paths: readonly string[]) {
    return this.mutate(['file', 'untrack', ...paths.map(rootFileset)])
  }

  setBookmark(name: string, commitId: string) {
    return this.mutate(['bookmark', 'set', jjString(name), '-r', commitId, '--allow-backwards'])
  }

  advanceBookmark(commitId: string) {
    return this.mutate(['bookmark', 'advance', '--to', commitId])
  }

  deleteBookmark(name: string) {
    return this.mutate(['bookmark', 'delete', exactBookmark(name)])
  }

  forgetBookmark(name: string) {
    return this.mutate(['bookmark', 'forget', exactBookmark(name)])
  }

  forgetCleanupBookmark(name: string) {
    return this.mutate(['bookmark', 'forget', exactBookmark(name)])
  }

  trackBookmark(name: string, remote: string) {
    return this.mutate(['bookmark', 'track', bookmarkRevision(name, remote)])
  }

  untrackBookmark(name: string, remote: string) {
    return this.mutate(['bookmark', 'untrack', bookmarkRevision(name, remote)])
  }

  renameBookmark(oldName: string, newName: string) {
    return this.mutate(['bookmark', 'rename', jjString(oldName), jjString(newName)])
  }

  // A clone made with `-b` limits plain fetches to those bookmarks, so branches can be named here.
  fetch(options: { interactive?: boolean; branches?: readonly string[] } = {}) {
    const env = options.interactive === false ? { UKEMI_ASKPASS_INTERACTIVE: '0' } : undefined
    const branches = [...new Set(options.branches ?? [])]
    const args =
      branches.length > 0
        ? ['git', 'fetch', ...branches.flatMap((name) => ['--branch', exactBookmark(name)])]
        : ['git', 'fetch', '--all-remotes']
    return this.mutate(args, {
      timeoutMs: NETWORK_TIMEOUT_MS,
      env,
      background: options.interactive === false,
    })
  }

  push(bookmarks?: string | readonly string[]) {
    const names = typeof bookmarks === 'string' ? [bookmarks] : (bookmarks ?? [])
    if (names.length > 0) {
      return this.mutate(pushArgs(names), { timeoutMs: NETWORK_TIMEOUT_MS })
    }
    return this.mutations.run(async () => {
      const local = (await this.bookmarkList())
        .filter((row) => row.remote === null && row.present)
        .map((row) => row.name)
      return this.runner.run({
        cwd: this.root,
        args: pushArgs(local),
        timeoutMs: NETWORK_TIMEOUT_MS,
      })
    })
  }

  undo() {
    return this.mutate(['undo'])
  }

  redo() {
    return this.mutate(['redo'])
  }

  // Sets the repository back to how it was after the operation, as a new operation.
  async restoreOperation(id: string) {
    return this.mutate(['op', 'restore', operationId(id)])
  }

  // Applies the inverse of one operation and keeps the later ones.
  async revertOperation(id: string) {
    return this.mutate(['op', 'revert', operationId(id)])
  }

  addWorkspace(path: string, name: string, revision: string) {
    return this.mutate(['workspace', 'add', '--name', name, '-r', revision, path])
  }

  forgetWorkspace(name: string) {
    return this.mutate(['workspace', 'forget', name])
  }

  newChangeInWorkspace(workspaceRoot: string) {
    return this.mutations.run(() => this.runner.run({ cwd: workspaceRoot, args: ['new'] }))
  }

  snapshotWorkspace(workspaceRoot: string): Promise<void> {
    return this.mutations.run(async () => {
      const background = { cwd: workspaceRoot, background: true }
      await this.runner.run({ ...background, args: ['workspace', 'update-stale'] })
      await this.runner.run({ ...background, args: ['status'] })
    })
  }

  static async initColocated(runner: JjRunner, directory: string): Promise<void> {
    await runner.run({ cwd: directory, args: ['git', 'init', '--colocate'] })
  }

  static initNew(
    runner: JjRunner,
    directory: string,
    options: NewRepoOptions,
  ): Promise<NewRepoResult> {
    return initNewRepo(runner, directory, options)
  }

  static async findRoot(runner: JjRunner, directory: string): Promise<string | null> {
    try {
      const { stdout } = await runner.run({
        cwd: directory,
        args: ['root'],
        ignoreWorkingCopy: true,
      })
      return stdout.trim() || null
    } catch {
      return null
    }
  }
}

function pushArgs(names: readonly string[]): readonly string[] {
  const targets =
    names.length > 0 ? names.flatMap((name) => ['--bookmark', exactBookmark(name)]) : ['--tracked']
  return ['git', 'push', ...targets]
}

export type InitFolder = 'jj' | 'git' | 'empty' | 'occupied'

export interface NewRepoOptions {
  branch: string
  remoteName: string
  remoteUrl?: string
}

export type NewRepoResult = { kind: 'cloned' } | { kind: 'created'; historyNotDownloaded: boolean }

export class InitIncompleteError extends Error {
  constructor(cause: unknown) {
    super(errorMessage(cause))
    this.name = 'InitIncompleteError'
  }
}

const execFileAsync = promisify(execFile)
const MISSING_BRANCH = /No matching branches found on remote/i
const EMPTY_REMOTE = /no commits|empty repository/i

export async function readInitFolder(directory: string): Promise<InitFolder> {
  if (await isDirectory(join(directory, '.jj'))) {
    return 'jj'
  }
  if (await pathExists(join(directory, '.git'))) {
    return 'git'
  }
  const entries = await readdir(directory)
  return entries.length === 0 ? 'empty' : 'occupied'
}

async function initNewRepo(
  runner: JjRunner,
  directory: string,
  options: NewRepoOptions,
): Promise<NewRepoResult> {
  const remoteUrl = options.remoteUrl?.trim() ?? ''
  const state = await readInitFolder(directory)
  if (remoteUrl && state === 'empty') {
    return cloneNewRepo(runner, directory, { ...options, remoteUrl })
  }
  return createLocalRepo(runner, directory, {
    branch: options.branch,
    remoteName: options.remoteName,
    remoteUrl,
    historyNotDownloaded: remoteUrl.length > 0 && state === 'occupied',
  })
}

async function cloneNewRepo(
  runner: JjRunner,
  directory: string,
  options: NewRepoOptions & { remoteUrl: string },
): Promise<NewRepoResult> {
  const local = {
    branch: options.branch,
    remoteName: options.remoteName,
    remoteUrl: options.remoteUrl,
    historyNotDownloaded: false,
  }
  try {
    const result = await runClone(runner, directory, options)
    if (!MISSING_BRANCH.test(result.stderr)) {
      return { kind: 'cloned' }
    }
  } catch (error: unknown) {
    await removeCloneMetadata(directory)
    if (error instanceof JjError && EMPTY_REMOTE.test(error.stderr)) {
      return createLocalRepo(runner, directory, local)
    }
    throw error
  }
  await removeCloneMetadata(directory)
  if (await remoteHasHeads(runner, options.remoteUrl)) {
    throw new Error(missingBranchMessage(options.branch))
  }
  return createLocalRepo(runner, directory, local)
}

function runClone(
  runner: JjRunner,
  directory: string,
  options: NewRepoOptions & { remoteUrl: string },
): Promise<RunResult> {
  return runner.run({
    cwd: dirname(directory),
    args: [
      'git',
      'clone',
      '--colocate',
      '--remote',
      options.remoteName,
      '-b',
      options.branch,
      options.remoteUrl,
      directory,
    ],
    timeoutMs: NETWORK_TIMEOUT_MS,
  })
}

async function createLocalRepo(
  runner: JjRunner,
  directory: string,
  options: {
    branch: string
    remoteName: string
    remoteUrl: string
    historyNotDownloaded: boolean
  },
): Promise<NewRepoResult> {
  await runner.run({ cwd: directory, args: ['git', 'init', '--colocate'] })
  try {
    await runner.run({
      cwd: directory,
      args: ['bookmark', 'create', jjString(options.branch), '-r', '@'],
    })
    if (options.remoteUrl) {
      await runner.run({
        cwd: directory,
        args: ['git', 'remote', 'add', options.remoteName, options.remoteUrl],
      })
    }
  } catch (error: unknown) {
    throw new InitIncompleteError(error)
  }
  return { kind: 'created', historyNotDownloaded: options.historyNotDownloaded }
}

async function remoteHasHeads(runner: JjRunner, url: string): Promise<boolean> {
  const host = hostSpawn('git', ['ls-remote', '--heads', url], { env: runner.hostEnv() })
  const { stdout } = await execFileAsync(host.command, host.args, {
    env: host.env,
    timeout: NETWORK_TIMEOUT_MS,
    encoding: 'utf8',
  })
  return stdout.trim().length > 0
}

function missingBranchMessage(branch: string): string {
  return `No matching branches found on remote: ${branch}`
}

async function removeCloneMetadata(directory: string): Promise<void> {
  await rm(join(directory, '.jj'), { recursive: true, force: true })
  await rm(join(directory, '.git'), { recursive: true, force: true })
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function parseTrunk(stdout: string): TrunkRef {
  const lines = stdout.split('\n')
  const commitId = lines[0]?.trim() ?? ''
  const bookmark = lines
    .slice(1)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  return {
    commitId: commitId.length > 0 ? commitId : null,
    bookmark: bookmark ?? null,
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

// An operation id is hex. Anything else would be read as an operation expression such as `@-`.
function operationId(id: string): string {
  if (!/^[0-9a-f]+$/.test(id)) {
    throw new Error(`not an operation id: ${id}`)
  }
  return id
}
