import { spawn } from 'node:child_process'
import type { Logger } from '../util/logger'

export const DEFAULT_TIMEOUT_MS = 60_000
export const NETWORK_TIMEOUT_MS = 120_000
const INDEX_LOCK_RETRIES = 3
const INDEX_LOCK_DELAY_MS = 500

const GLOBAL_ARGS = ['--color=never', '--no-pager']

export interface RunOptions {
  cwd: string
  args: readonly string[]
  stdin?: string
  timeoutMs?: number
  ignoreWorkingCopy?: boolean
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
  return (withoutHints.join('\n') || 'jj failed').replace(/^Error:\s*/, '')
}

const MAX_LOGGED_ARG = 120

export function describeArgs(args: readonly string[]): string {
  return args
    .map((arg, index) => {
      if (args[index - 1] === '-T') {
        return '<template>'
      }
      const configValue = arg.startsWith('--config=') ? arg.indexOf('=', '--config='.length) : -1
      if (configValue >= 0) {
        return `${arg.slice(0, configValue)}=…`
      }
      return arg.length > MAX_LOGGED_ARG ? `${arg.slice(0, MAX_LOGGED_ARG)}…` : arg
    })
    .join(' ')
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export class JjRunner {
  private extraEnv: Readonly<Record<string, string>> = {}

  constructor(
    private binaryPath: string,
    private readonly logger: Logger,
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

  async run(options: RunOptions): Promise<RunResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.runOnce(options)
      } catch (error: unknown) {
        if (error instanceof JjError && error.isIndexLocked && attempt < INDEX_LOCK_RETRIES) {
          this.logger.warn('git index is locked, retrying')
          await sleep(INDEX_LOCK_DELAY_MS)
          continue
        }
        if (error instanceof JjError && error.isStaleWorkingCopy && attempt === 0) {
          this.logger.warn('working copy is stale, updating')
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
      const child = spawn(this.binaryPath, args, {
        cwd: options.cwd,
        env: { ...process.env, ...this.extraEnv, JJ_EDITOR: 'false', GIT_TERMINAL_PROMPT: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let hasTimedOut = false
      const timer = setTimeout(() => {
        hasTimedOut = true
        child.kill('SIGTERM')
      }, timeoutMs)

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(new JjError(`Failed to start jj: ${error.message}`, args, '', null))
      })
      child.on('close', (code, signal) => {
        clearTimeout(timer)
        const out = Buffer.concat(stdout).toString('utf8')
        const err = Buffer.concat(stderr).toString('utf8')
        const elapsed = Date.now() - started
        this.logger.info(`jj ${describeArgs(options.args)} (${elapsed} ms, exit ${code ?? signal})`)
        if (hasTimedOut) {
          reject(new JjError(`jj timed out after ${timeoutMs / 1000} s`, args, err, code))
          return
        }
        if (code !== 0) {
          if (err.trim()) {
            this.logger.error(err.trim())
          }
          reject(new JjError(summarizeStderr(err), args, err, code))
          return
        }
        resolve({ stdout: out, stderr: err })
      })

      child.stdin.end(options.stdin ?? '')
    })
  }

  async runBytes(options: RunOptions): Promise<Buffer> {
    const args = [...GLOBAL_ARGS, '--ignore-working-copy', ...options.args]
    return new Promise((resolve, reject) => {
      const child = spawn(this.binaryPath, args, { cwd: options.cwd, env: process.env })
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
