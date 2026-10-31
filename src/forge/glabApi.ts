import { cliContentType, isSafeEndpoint, responseFromCli, runCli, type CliRun } from './cli'
import { isSafeHttpsHost } from './hostName'
import type { HttpFetch } from './types'

export type GlabRun = CliRun

export function glabFetch(host: string, run: GlabRun = runGlab): HttpFetch {
  return async (url, init = {}) => {
    const endpoint = glabEndpoint(host, url)
    const method = (init.method ?? 'GET').toUpperCase()
    const stdin = typeof init.body === 'string' ? init.body : undefined
    const args = ['api', '--hostname', host, '--include', '--method', method]
    if (stdin !== undefined) {
      args.push('--header', `Content-Type: ${cliContentType(init.headers)}`, '--input', '-')
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
  if (!isSafeEndpoint(endpoint)) {
    throw new Error('Refusing GitLab URL')
  }
  return endpoint
}

export function responseFromGlab(stdout: string, code: number): Response {
  return responseFromCli(stdout, code, 'glab')
}

export const runGlab: GlabRun = (args, stdin) => runCli('glab', args, stdin)
