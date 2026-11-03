import { spawn } from 'node:child_process'
import { hostSpawn } from './hostProcess'
import { killTree, OWN_GROUP } from './processTree'

export interface ToolRunOptions {
  cwd: string
  stdin?: string
  env?: Readonly<Record<string, string>>
  timeoutMs: number
  maxOutput: number
  signal?: AbortSignal
}

export interface ToolRunResult {
  stdout: string
  stderr: string
  code: number
}

// Runs a program of the user's machine to completion. It is killed when it runs too long,
// prints too much or the signal aborts; the promise then resolves with what it printed so far.
export function runTool(
  command: string,
  args: readonly string[],
  options: ToolRunOptions,
): Promise<ToolRunResult> {
  return new Promise((resolve, reject) => {
    const host = hostSpawn(command, args, { cwd: options.cwd, env: options.env })
    const child = spawn(host.command, host.args, {
      cwd: options.cwd,
      env: host.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: OWN_GROUP,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let size = 0
    const kill = () => killTree(child)
    const timer = setTimeout(kill, options.timeoutMs)
    options.signal?.addEventListener('abort', kill, { once: true })
    if (options.signal?.aborted) {
      kill()
    }
    const collect = (into: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length
      if (size > options.maxOutput) {
        kill()
        return
      }
      into.push(chunk)
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    const done = () => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', kill)
    }
    child.on('error', (error) => {
      done()
      reject(error)
    })
    child.on('close', (code) => {
      done()
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code: code ?? 1,
      })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(options.stdin ?? '')
  })
}
