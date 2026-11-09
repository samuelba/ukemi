import { spawn, type ChildProcess } from 'node:child_process'
import { basename } from 'node:path'
import { hostSpawn } from '../util/hostProcess'
import { killTree, OWN_GROUP } from '../util/processTree'
import type { Logger } from '../util/logger'
import { redactUrlCredentials } from '../util/text'
import { askVersion } from './binary'
import type { JjVersion } from './parse'

export const DEFAULT_TIMEOUT_MS = 60_000
export const NETWORK_TIMEOUT_MS = 120_000
// `jj fix` runs the user's formatters over every changed file, which can take a while.
export const FIX_TIMEOUT_MS = 300_000
const INDEX_LOCK_RETRIES = 3
const INDEX_LOCK_DELAY_MS = 500
// How long jj and its helpers get to end after SIGTERM before they are killed.
const KILL_GRACE_MS = 3_000

const GLOBAL_ARGS = ['--color=never', '--no-pager']

export interface RunOptions {
  cwd: string
  args: readonly string[]
  stdin?: string
  timeoutMs?: number
  ignoreWorkingCopy?: boolean
  env?: Readonly<Record<string, string>>
  // Nobody waits for the result, like a snapshot or an auto-fetch: warnings are only logged.
  background?: boolean
}

export interface JjWarning {
  cwd: string
  args: readonly string[]
  text: string
}

export interface RunResult {
  stdout: string
  stderr: string
}

export class JjError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message)
    this.name = 'JjError'
  }

  get isStaleWorkingCopy(): boolean {
    return /working copy is stale/i.test(this.stderr)
  }

  get isIndexLocked(): boolean {
    return /index\.lock/.test(this.stderr)
  }
}

// The error and its hints. jj and its argument parser write `Error:`, older parsers `error:`, and
// the parser adds a usage block that does not help in a message.
export function summarizeStderr(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
  const errorIndex = lines.findIndex((line) => ERROR_LINE.test(line))
  const relevant = errorIndex >= 0 ? lines.slice(errorIndex) : lines
  const usageIndex = relevant.findIndex((line) => line.startsWith('Usage:'))
  const kept = usageIndex >= 0 ? relevant.slice(0, usageIndex) : relevant
  return redactUrlCredentials((kept.join('\n') || 'jj failed').replace(ERROR_LINE, ''))
}

const ERROR_LINE = /^error:\s*/i

function timeoutMessage(timeoutMs: number, stderr: string): string {
  const message = `jj timed out after ${timeoutMs / 1000} s`
  return stderr.trim() ? `${message}: ${summarizeStderr(stderr)}` : message
}

// The warnings jj printed, each with the indented lines and hints that follow it.
export function stderrWarnings(stderr: string): string[] {
  const warnings: string[][] = []
  let current: string[] | null = null
  for (const line of stderr.split('\n').map((text) => text.trimEnd())) {
    if (line.startsWith('Warning:')) {
      current = [line.replace(/^Warning:\s*/, '')]
      warnings.push(current)
    } else if (current && line.length > 0 && (/^\s/.test(line) || line.startsWith('Hint:'))) {
      current.push(line)
    } else {
      current = null
    }
  }
  return warnings.map((lines) => redactUrlCredentials(lines.join('\n')))
}

const MAX_LOGGED_ARG = 120

const AT_OP = '--at-op='
const LOGGED_OPERATION_LENGTH = 12

export function describeArgs(args: readonly string[]): string {
  return args
    .map((arg, index) => {
      if (args[index - 1] === '-T') {
        return '<template>'
      }
      if (arg.startsWith(AT_OP)) {
        return `${arg.slice(0, AT_OP.length + LOGGED_OPERATION_LENGTH)}…`
      }
      const configValue = arg.startsWith('--config=') ? arg.indexOf('=', '--config='.length) : -1
      if (configValue >= 0) {
        return `${arg.slice(0, configValue)}=…`
      }
      const safe = redactUrlCredentials(arg)
      return safe.length > MAX_LOGGED_ARG ? `${safe.slice(0, MAX_LOGGED_ARG)}…` : safe
    })
    .join(' ')
}

// Which repository a log line is about, when several are open.
function repoTag(cwd: string): string {
  return `[${basename(cwd) || cwd}]`
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// A timeout that can stop while the user answers a git or ssh prompt, and go on afterwards.
class Countdown {
  private timer: ReturnType<typeof setTimeout> | null = null
  private startedAt = 0

  constructor(
    private remainingMs: number,
    private readonly onEnd: () => void,
  ) {}

  resume(): void {
    if (this.timer) {
      return
    }
    this.startedAt = Date.now()
    this.timer = setTimeout(() => {
      this.timer = null
      this.onEnd()
    }, this.remainingMs)
  }

  pause(): void {
    if (!this.timer) {
      return
    }
    clearTimeout(this.timer)
    this.timer = null
    this.remainingMs = Math.max(0, this.remainingMs - (Date.now() - this.startedAt))
  }
}

export class JjRunner {
  private extraEnv: Readonly<Record<string, string>> = {}
  private readonly countdowns = new Set<Countdown>()
  private openPrompts = 0
  private warningHandler: ((warning: JjWarning) => void) | null = null
  // jj processes still running, so closing the window that owns this runner can end them.
  private readonly running = new Set<ChildProcess>()
  private isDisposed = false
  private versionProbe: { path: string; version: Promise<JjVersion | null> } | null = null

  constructor(
    private binaryPath: string,
    private readonly logger: Logger,
    private readonly options: { killGraceMs?: number } = {},
  ) {}

  get binary(): string {
    return this.binaryPath
  }

  useBinary(path: string): void {
    this.binaryPath = path
  }

  // The version of the jj this runner starts, asked once for each binary. Null when jj does not
  // answer, which callers treat as a version without the newer features.
  version(): Promise<JjVersion | null> {
    if (this.versionProbe?.path !== this.binaryPath) {
      this.versionProbe = { path: this.binaryPath, version: askVersion(this.binaryPath) }
    }
    return this.versionProbe.version
  }

  setEnvironment(env: Readonly<Record<string, string>>): void {
    this.extraEnv = env
  }

  // The variables Ukemi adds for jj and git: askpass, and no terminal prompts.
  hostEnv(overrides: Readonly<Record<string, string>> = {}): Record<string, string> {
    return { ...this.extraEnv, ...overrides, GIT_TERMINAL_PROMPT: '0' }
  }

  // Receives the warnings of commands that succeed while someone waits for them.
  onWarning(handler: (warning: JjWarning) => void): void {
    this.warningHandler = handler
  }

  // Stops every timeout while the task runs, so the time the user takes to answer a prompt from
  // git or ssh does not count against the command that asked.
  async whilePrompting<T>(task: () => Promise<T>): Promise<T> {
    if (this.openPrompts++ === 0) {
      this.countdowns.forEach((countdown) => countdown.pause())
    }
    try {
      return await task()
    } finally {
      if (--this.openPrompts === 0) {
        this.countdowns.forEach((countdown) => countdown.resume())
      }
    }
  }

  // Ends every jj process this runner started, with git and ssh below them, and refuses new runs.
  // Their callers get an error, as after a timeout.
  dispose(): void {
    if (this.isDisposed) {
      return
    }
    this.isDisposed = true
    const grace = this.options.killGraceMs ?? KILL_GRACE_MS
    for (const child of this.running) {
      killTree(child, 'SIGTERM')
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          killTree(child, 'SIGKILL')
        }
      }, grace).unref()
    }
    this.running.clear()
  }

  private track(child: ChildProcess): void {
    this.running.add(child)
    child.once('exit', () => this.running.delete(child))
    child.once('error', () => this.running.delete(child))
  }

  private stopped(args: readonly string[]): JjError {
    return new JjError('jj was stopped because its window closed', args, '', null)
  }

  async run(options: RunOptions): Promise<RunResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.runOnce(options)
      } catch (error: unknown) {
        if (error instanceof JjError && error.isIndexLocked && attempt < INDEX_LOCK_RETRIES) {
          this.logger.warn(`${repoTag(options.cwd)} git index is locked, retrying`)
          await sleep(INDEX_LOCK_DELAY_MS)
          continue
        }
        if (error instanceof JjError && error.isStaleWorkingCopy && attempt === 0) {
          this.logger.warn(`${repoTag(options.cwd)} working copy is stale, updating`)
          await this.runOnce({ cwd: options.cwd, args: ['workspace', 'update-stale'] })
          continue
        }
        throw error
      }
    }
  }

  private runOnce(options: RunOptions): Promise<RunResult> {
    const args = [
      ...GLOBAL_ARGS,
      ...(options.ignoreWorkingCopy ? ['--ignore-working-copy'] : []),
      ...options.args,
    ]
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const started = Date.now()
    if (this.isDisposed) {
      return Promise.reject(this.stopped(args))
    }

    return new Promise((resolve, reject) => {
      const host = hostSpawn(this.binaryPath, args, {
        cwd: options.cwd,
        env: this.hostEnv({ ...options.env, JJ_EDITOR: 'false' }),
      })
      // In its own process group, so a timeout also ends git and ssh, which hold jj's pipes. See
      // killTree.
      const child = spawn(host.command, host.args, {
        cwd: options.cwd,
        env: host.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: OWN_GROUP,
      })
      this.track(child)
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let hasTimedOut = false
      let killTimer: ReturnType<typeof setTimeout> | null = null
      const countdown = new Countdown(timeoutMs, () => {
        this.countdowns.delete(countdown)
        hasTimedOut = true
        killTree(child, 'SIGTERM')
        killTimer = setTimeout(
          () => killTree(child, 'SIGKILL'),
          this.options.killGraceMs ?? KILL_GRACE_MS,
        )
      })
      this.countdowns.add(countdown)
      if (this.openPrompts === 0) {
        countdown.resume()
      }
      const settle = () => {
        countdown.pause()
        this.countdowns.delete(countdown)
        if (killTimer) {
          clearTimeout(killTimer)
        }
      }

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.on('error', (error) => {
        settle()
        reject(new JjError(`Failed to start jj: ${error.message}`, args, '', null))
      })
      // After a timeout, a helper that ignores the signals can still hold the pipes, and then
      // 'close' never comes. jj itself has ended once 'exit' comes.
      child.on('exit', (code) => {
        if (hasTimedOut) {
          settle()
          const err = Buffer.concat(stderr).toString('utf8')
          reject(new JjError(timeoutMessage(timeoutMs, err), args, err, code))
        }
      })
      child.on('close', (code, signal) => {
        settle()
        const out = Buffer.concat(stdout).toString('utf8')
        const err = Buffer.concat(stderr).toString('utf8')
        const elapsed = Date.now() - started
        this.logger.info(
          `${repoTag(options.cwd)} jj ${describeArgs(options.args)} (${elapsed} ms, exit ${code ?? signal})`,
        )
        if (hasTimedOut) {
          reject(new JjError(timeoutMessage(timeoutMs, err), args, err, code))
          return
        }
        if (this.isDisposed && code !== 0) {
          reject(this.stopped(args))
          return
        }
        if (code !== 0) {
          if (err.trim()) {
            this.logger.error(`${repoTag(options.cwd)} ${redactUrlCredentials(err.trim())}`)
          }
          reject(new JjError(summarizeStderr(err), args, err, code))
          return
        }
        this.reportWarnings(options, err)
        resolve({ stdout: out, stderr: err })
      })

      child.stdin.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EPIPE') {
          this.logger.warn(`${repoTag(options.cwd)} jj stdin: ${error.message}`)
        }
      })
      child.stdin.end(options.stdin ?? '')
    })
  }

  private reportWarnings(options: RunOptions, stderr: string): void {
    const quiet = options.background || options.ignoreWorkingCopy
    for (const text of stderrWarnings(stderr)) {
      this.logger.warn(`${repoTag(options.cwd)} ${text}`)
      if (!quiet) {
        this.warningHandler?.({ cwd: options.cwd, args: options.args, text })
      }
    }
  }

  async runBytes(options: RunOptions): Promise<Buffer> {
    const args = [...GLOBAL_ARGS, '--ignore-working-copy', ...options.args]
    if (this.isDisposed) {
      throw this.stopped(args)
    }
    return new Promise((resolve, reject) => {
      const host = hostSpawn(this.binaryPath, args, { cwd: options.cwd })
      const child = spawn(host.command, host.args, {
        cwd: options.cwd,
        env: host.env,
        detached: OWN_GROUP,
      })
      this.track(child)
      const chunks: Buffer[] = []
      const errors: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
      child.on('error', (error) => reject(new JjError(error.message, args, '', null)))
      child.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks))
          return
        }
        const err = Buffer.concat(errors).toString('utf8')
        reject(new JjError(summarizeStderr(err), args, err, code))
      })
    })
  }
}
