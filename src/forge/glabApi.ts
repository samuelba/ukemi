import { cliFetch, isSafeEndpoint, runCli, type CliRun } from './cli'
import { isSafeHttpsHost } from './hostName'
import type { HttpFetch } from './types'

export type GlabRun = CliRun

export function glabFetch(host: string, run: GlabRun = runGlab): HttpFetch {
  return cliFetch('glab', host, (url) => glabEndpoint(host, url), run)
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

export const runGlab: GlabRun = (args, stdin) => runCli('glab', args, stdin)
