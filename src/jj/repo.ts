import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type {
  ChangedFile,
  Commit,
  EvolutionEntry,
  Operation,
  Remote,
  Workspace,
} from '../../shared/model'
import { errorMessage } from '../util/logger'
import { SerialQueue } from '../util/serialQueue'
import {
  parseBookmarks,
  parseCommitIds,
  parseDiffFiles,
  parseEvolution,
  parseFiles,
  parseLog,
  parseOperations,
  parseRemotes,
  parseWorkspaces,
} from './parse'
import { rootFileset } from './revsets'
import { JjError, JjRunner, NETWORK_TIMEOUT_MS, type RunResult } from './runner'
import { jjString } from './templates'
import {
  BOOKMARK_LIST_GRAPH_TEMPLATE,
  BOOKMARK_LIST_TEMPLATE,
  COMMIT_ID_TEMPLATE,
  DIFF_FILES_TEMPLATE,
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
export const MAX_EVOLUTION_ENTRIES = 200

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
  ) {}

  get isColocated(): boolean {
    return existsSync(join(this.root, '.git'))
  }

  get hasPendingMutations(): boolean {
    return this.mutations.size > 0
  }

  private read(args: readonly string[]): Promise<RunResult> {
    return this.runner.run({ cwd: this.root, args, ignoreWorkingCopy: true })
  }

  private mutate(
    args: readonly string[],
    options: { stdin?: string; timeoutMs?: number; env?: Readonly<Record<string, string>> } = {},
  ) {
    return this.mutations.run(() => this.runner.run({ cwd: this.root, args, ...options }))
  }

  snapshot(): Promise<RunResult> {
    return this.mutate(['util', 'snapshot'])
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

  async copyFiles(fromCommitId: string, intoCommitId: string, paths: readonly string[]) {
    const [target] = await this.log(intoCommitId)
    if (!target) {
      throw new Error(`Target change ${intoCommitId} not found`)
    }
    await this.restoreInto(fromCommitId, target.commitId, paths)
    const [after] = await this.log(target.changeId)
    if (!after) {
      throw new Error(`Target change ${target.changeId} not found`)
    }
    if (await this.diffHasAnyPath(after.commitId, paths)) {
      return
    }
    // An empty descendant already has the source content, so restore is a no-op.
    // Move it beside the source, then the same restore becomes a real change.
    if (after.isEmpty && (await this.isProperDescendant(after.commitId, fromCommitId))) {
      await this.rebase(after.commitId, `parents(${fromCommitId})`, 'revision')
      const [moved] = await this.log(target.changeId)
      if (!moved) {
        throw new Error(`Target change ${target.changeId} not found after rebase`)
      }
      await this.restoreInto(fromCommitId, moved.commitId, paths)
      return
    }
    throw new Error('Target already contains this file content')
  }

  private restoreInto(fromCommitId: string, intoCommitId: string, paths: readonly string[]) {
    return this.mutate([
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
    return this.mutate(['bookmark', 'set', name, '-r', commitId, '--allow-backwards'])
  }

  advanceBookmark(commitId: string) {
    return this.mutate(['bookmark', 'advance', '--to', commitId])
  }

  deleteBookmark(name: string) {
    return this.mutate(['bookmark', 'delete', `exact:${name}`])
  }

  forgetBookmark(name: string) {
    return this.mutate(['bookmark', 'forget', `exact:${name}`])
  }

  forgetCleanupBookmark(name: string) {
    return this.mutate(['bookmark', 'forget', `exact:${jjString(name)}`])
  }

  trackBookmark(name: string, remote: string) {
    return this.mutate(['bookmark', 'track', `${name}@${remote}`])
  }

  untrackBookmark(name: string, remote: string) {
    return this.mutate(['bookmark', 'untrack', `${name}@${remote}`])
  }

  renameBookmark(oldName: string, newName: string) {
    return this.mutate(['bookmark', 'rename', oldName, newName])
  }

  fetch(options: { interactive?: boolean } = {}) {
    const env = options.interactive === false ? { UKEMI_ASKPASS_INTERACTIVE: '0' } : undefined
    return this.mutate(['git', 'fetch', '--all-remotes'], { timeoutMs: NETWORK_TIMEOUT_MS, env })
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
      await this.runner.run({ cwd: workspaceRoot, args: ['workspace', 'update-stale'] })
      await this.runner.run({ cwd: workspaceRoot, args: ['status'] })
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
    names.length > 0 ? names.flatMap((name) => ['--bookmark', `exact:${name}`]) : ['--tracked']
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
      args: ['bookmark', 'create', options.branch, '-r', '@'],
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
  const { stdout } = await execFileAsync('git', ['ls-remote', '--heads', url], {
    env: runner.spawnEnv(),
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
