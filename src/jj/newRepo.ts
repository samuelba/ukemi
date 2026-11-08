import { execFile } from 'node:child_process'
import { readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { isDirectory, pathExists } from '../util/fs'
import { hostSpawn } from '../util/hostProcess'
import { errorMessage } from '../util/logger'
import { JjError, NETWORK_TIMEOUT_MS, type JjRunner, type RunResult } from './runner'
import { jjString } from './templates'

// Setting up a repository in a folder: jj init in a Git repository, a new repository, or a clone.

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

export async function initNewRepo(
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

export async function initColocated(runner: JjRunner, directory: string): Promise<void> {
  await runner.run({ cwd: directory, args: ['git', 'init', '--colocate'] })
}
