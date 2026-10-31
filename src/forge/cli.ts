import { spawn } from 'node:child_process'
import { homedir } from 'node:os'

const CLI_TIMEOUT_MS = 30_000
const MAX_OUTPUT = 10 * 1024 * 1024
const MISSING_RETRY_MS = 30_000

export type CliBinary = 'gh' | 'glab'

export interface CliRunResult {
  stdout: string
  code: number
}

export type CliRun = (args: readonly string[], stdin: string | undefined) => Promise<CliRunResult>

export function runCli(
  binary: CliBinary,
  args: readonly string[],
  stdin: string | undefined,
): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      // A neutral folder keeps the CLI from picking up a repository's own configuration.
      cwd: homedir(),
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    let size = 0
    const timer = setTimeout(() => child.kill(), CLI_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_OUTPUT) {
        child.kill()
        return
      }
      stdout.push(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout: Buffer.concat(stdout).toString('utf8'), code: code ?? 1 })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(stdin ?? '')
  })
}

const availability = new Map<string, { ok: boolean; at: number }>()

// A missing binary is retried after a short delay so that installing it takes effect without a restart.
export async function cliAvailable(
  binary: CliBinary,
  run: CliRun = (args, stdin) => runCli(binary, args, stdin),
  now: number = Date.now(),
): Promise<boolean> {
  const known = availability.get(binary)
  if (known && (known.ok || now - known.at < MISSING_RETRY_MS)) {
    return known.ok
  }
  let ok: boolean
  try {
    await run(['--version'], undefined)
    ok = true
  } catch {
    ok = false
  }
  availability.set(binary, { ok, at: now })
  return ok
}

export function resetCliAvailability(): void {
  availability.clear()
}

// Both `gh api` and `glab api` print the status line and headers, a blank line, then the body.
export function responseFromCli(stdout: string, code: number, name: string): Response {
  const statusLine = /^HTTP\/\d+(?:\.\d+)?\s+(\d{3})/.exec(stdout)
  if (!statusLine) {
    return new Response(JSON.stringify({ message: `${name} api failed` }), {
      status: code === 0 ? 200 : 500,
    })
  }
  const separator = /\r?\n\r?\n/.exec(stdout)
  const body = separator ? stdout.slice(separator.index + separator[0].length) : ''
  return new Response(body, { status: Number(statusLine[1]) })
}

const DEFAULT_CONTENT_TYPE = 'application/json'
const SAFE_MEDIA_TYPE =
  /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+(?:[ \t]*;[ \t]*[\w!#$&^.+-]+=[\w!#$&^.+-]+)*$/

export function cliContentType(headers: HeadersInit | undefined): string {
  const value = contentTypeHeader(headers)?.trim()
  return value && SAFE_MEDIA_TYPE.test(value) ? value : DEFAULT_CONTENT_TYPE
}

function contentTypeHeader(headers: HeadersInit | undefined): string | undefined {
  if (!headers) {
    return undefined
  }
  if (Array.isArray(headers)) {
    const found = headers.find(([name]) => name.toLowerCase() === 'content-type')
    return found?.[1]
  }
  if (headers instanceof Headers) {
    return headers.get('content-type') ?? undefined
  }
  const name = Object.keys(headers).find((key) => key.toLowerCase() === 'content-type')
  return name ? headers[name] : undefined
}

export function isSafeEndpoint(endpoint: string): boolean {
  return (
    endpoint.startsWith('/') &&
    !/[\n\r\0{}]/.test(endpoint) &&
    !endpoint.startsWith('//') &&
    !endpoint.includes('\\')
  )
}
