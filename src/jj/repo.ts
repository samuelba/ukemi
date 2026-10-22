import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ChangedFile, Commit, Operation, Remote, Workspace } from '../../shared/model'
import { SerialQueue } from '../util/serialQueue'
import {
  parseCommitIds,
  parseFiles,
  parseLog,
  parseOperations,
  parseRemotes,
  parseWorkspaces,
} from './parse'
import { rootFileset } from './revsets'
import { JjRunner, NETWORK_TIMEOUT_MS, type RunResult } from './runner'
import {
  COMMIT_ID_TEMPLATE,
  FILES_TEMPLATE,
  LOG_TEMPLATE,
  OP_LOG_TEMPLATE,
  PUSHED_BOOKMARK_TEMPLATE,
  WORKSPACE_TEMPLATE,
} from './templates'

export const MAX_LOG_ENTRIES = 2000

export type SplitDirection = 'below' | 'above'
export type RebaseMode = 'source' | 'revision'

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

  private mutate(args: readonly string[], options: { stdin?: string; timeoutMs?: number } = {}) {
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

  async files(commitId: string): Promise<ChangedFile[]> {
    const { stdout } = await this.read(['log', '--no-graph', '-r', commitId, '-T', FILES_TEMPLATE])
    return parseFiles(stdout)
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

  async trunkBookmark(): Promise<string | null> {
    const { stdout } = await this.read([
      'log',
      '--no-graph',
      '-r',
      'present(trunk())',
      '-T',
      'remote_bookmarks.map(|b| b.name()).join("\\n") ++ "\\n"',
    ])
    return stdout.split('\n').find((line) => line.trim().length > 0) ?? null
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

  duplicate(revset: string) {
    return this.mutate(['duplicate', revset])
  }

  revert(commitId: string) {
    return this.mutate(['revert', '-r', commitId, '--onto', '@'])
  }

  rebase(source: string, destination: string, mode: RebaseMode) {
    return this.mutate(['rebase', mode === 'source' ? '-s' : '-r', source, '-d', destination])
  }

  restoreFiles(commitId: string, paths: readonly string[]) {
    return this.mutate(['restore', '--changes-in', commitId, ...paths.map(rootFileset)])
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

  deleteBookmark(name: string) {
    return this.mutate(['bookmark', 'delete', `exact:${name}`])
  }

  forgetBookmark(name: string) {
    return this.mutate(['bookmark', 'forget', `exact:${name}`])
  }

  trackBookmark(name: string, remote: string) {
    return this.mutate(['bookmark', 'track', `${name}@${remote}`])
  }

  fetch() {
    return this.mutate(['git', 'fetch', '--all-remotes'], { timeoutMs: NETWORK_TIMEOUT_MS })
  }

  push(bookmarks?: string | readonly string[]) {
    const names = typeof bookmarks === 'string' ? [bookmarks] : (bookmarks ?? [])
    const target =
      names.length > 0 ? names.flatMap((name) => ['--bookmark', `exact:${name}`]) : ['--tracked']
    return this.mutate(['git', 'push', ...target], { timeoutMs: NETWORK_TIMEOUT_MS })
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

  static async initColocated(runner: JjRunner, directory: string): Promise<void> {
    await runner.run({ cwd: directory, args: ['git', 'init', '--colocate'] })
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
