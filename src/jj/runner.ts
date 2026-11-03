import { spawn } from 'node:child_process'
import { basename } from 'node:path'
import { hostSpawn } from '../util/hostProcess'
import { killTree, OWN_GROUP } from '../util/processTree'
import type { Logger } from '../util/logger'
import { redactUrlCredentials } from '../util/text'

export const DEFAULT_TIMEOUT_MS = 60_000
export const NETWORK_TIMEOUT_MS = 120_000
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

export function summarizeStderr(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
  const errorIndex = lines.findIndex((line) => line.startsWith('Error:'))
  const relevant = errorIndex >= 0 ? lines.slice(errorIndex) : lines
  const withoutHints = relevant.filter((line) => !line.startsWith('Hint:'))
  return redactUrlCredentials((withoutHints.join('\n') || 'jj failed').replace(/^Error:\s*/, ''))
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

  setEnvironment(env: Readonly<Record<string, string>>): void {
    this.extraEnv = env
  }

  // The variables Ukemi adds for jj and git: askpass, and no terminal prompts.
  hostEnv(overrides: Readonly<Record<string, string>> = {}): Record<string, string> {
    return { ...this.extraEnv, ...overrides, GIT_TERMINAL_PROMPT: '0' }
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
          reject(new JjError(`jj timed out after ${timeoutMs / 1000} s`, args, '', code))
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
          reject(new JjError(`jj timed out after ${timeoutMs / 1000} s`, args, err, code))
          return
        }
        if (code !== 0) {
          if (err.trim()) {
            this.logger.error(`${repoTag(options.cwd)} ${redactUrlCredentials(err.trim())}`)
          }
          reject(new JjError(summarizeStderr(err), args, err, code))
          return
        }
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

  async runBytes(options: RunOptions): Promise<Buffer> {
    const args = [...GLOBAL_ARGS, '--ignore-working-copy', ...options.args]
    return new Promise((resolve, reject) => {
      const host = hostSpawn(this.binaryPath, args, { cwd: options.cwd })
      const child = spawn(host.command, host.args, { cwd: options.cwd, env: host.env })
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
