import { spawn } from 'node:child_process'
import { isSafeHttpsHost } from './hostName'
import type { HttpFetch } from './types'

const GLAB_TIMEOUT_MS = 30_000
const MAX_OUTPUT = 10 * 1024 * 1024
const DEFAULT_CONTENT_TYPE = 'application/json'
const SAFE_MEDIA_TYPE =
  /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+(?:[ \t]*;[ \t]*[\w!#$&^.+-]+=[\w!#$&^.+-]+)*$/

export interface GlabRunResult {
  stdout: string
  code: number
}

export type GlabRun = (args: readonly string[], stdin: string | undefined) => Promise<GlabRunResult>

function glabContentType(headers: HeadersInit | undefined): string {
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

export function glabFetch(host: string, run: GlabRun = runGlab): HttpFetch {
  return async (url, init = {}) => {
    const endpoint = glabEndpoint(host, url)
    const method = (init.method ?? 'GET').toUpperCase()
    const stdin = typeof init.body === 'string' ? init.body : undefined
    const args = ['api', '--hostname', host, '--include', '--method', method]
    if (stdin !== undefined) {
      args.push('--header', `Content-Type: ${glabContentType(init.headers)}`, '--input', '-')
    }
    args.push(endpoint)
    const result = await run(args, stdin)
    return responseFromGlab(result.stdout, result.code)
  }
}

export function glabEndpoint(host: string, url: string): string {
  if (!isSafeHttpsHost(host)) {
    throw new Error('Invalid GitLab host')
  }
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== host.toLowerCase()) {
    throw new Error('Refusing GitLab URL')
  }
  if (!parsed.pathname.startsWith('/api/v4/') || parsed.username || parsed.password) {
    throw new Error('Refusing GitLab URL')
  }
  const endpoint = `${parsed.pathname.slice('/api/v4'.length)}${parsed.search}`
  if (!endpoint.startsWith('/') || endpoint.includes('\n') || endpoint.includes('\0')) {
    throw new Error('Refusing GitLab URL')
  }
  return endpoint
}

export function responseFromGlab(stdout: string, code: number): Response {
  const statusLine = /^HTTP\/\d+(?:\.\d+)?\s+(\d{3})/.exec(stdout)
  if (!statusLine) {
    return new Response(JSON.stringify({ message: 'glab api failed' }), {
      status: code === 0 ? 200 : 500,
    })
  }
  const separated = stdout.split(/\r?\n\r?\n/, 2)[1] ?? ''
  return new Response(separated, { status: Number(statusLine[1]) })
}

export function runGlab(
  args: readonly string[],
  stdin: string | undefined,
): Promise<GlabRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('glab', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    let size = 0
    const timer = setTimeout(() => child.kill(), GLAB_TIMEOUT_MS)
    const finish = (result: GlabRunResult) => {
      clearTimeout(timer)
      resolve(result)
    }
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
      finish({ stdout: Buffer.concat(stdout).toString('utf8'), code: code ?? 1 })
    })
    if (stdin !== undefined) {
      child.stdin.end(stdin)
    } else {
      child.stdin.end()
    }
  })
}
