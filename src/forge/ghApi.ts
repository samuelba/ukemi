import { cliContentType, isSafeEndpoint, responseFromCli, runCli, type CliRun } from './cli'
import { isSafeHttpsHost } from './hostName'
import type { HttpFetch } from './types'

export type GhRun = CliRun

export const runGh: GhRun = (args, stdin) => runCli('gh', args, stdin)

const GITHUB_API_HOST = 'api.github.com'

// Maps an API URL that GithubClient builds to the endpoint that `gh api --hostname <host>` expects.
export function ghEndpoint(host: string, url: string): string {
  if (!isSafeHttpsHost(host)) {
    throw new Error('Invalid GitHub host')
  }
  const parsed = new URL(url)
  const isDotCom = host.toLowerCase() === 'github.com'
  const expectedHost = isDotCom ? GITHUB_API_HOST : host.toLowerCase()
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname.toLowerCase() !== expectedHost ||
    parsed.port ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('Refusing GitHub URL')
  }
  // github.com serves the API from its own host; Enterprise serves it under /api.
  const restPrefix = isDotCom ? '' : '/api/v3'
  const graphqlPath = isDotCom ? '/graphql' : '/api/graphql'
  let endpoint: string
  if (parsed.pathname === graphqlPath) {
    endpoint = '/graphql'
  } else if (parsed.pathname.startsWith(`${restPrefix}/`)) {
    endpoint = parsed.pathname.slice(restPrefix.length)
  } else {
    throw new Error('Refusing GitHub URL')
  }
  endpoint += parsed.search
  if (!isSafeEndpoint(endpoint)) {
    throw new Error('Refusing GitHub URL')
  }
  return endpoint
}

export function ghFetch(host: string, run: GhRun = runGh): HttpFetch {
  return async (url, init = {}) => {
    const endpoint = ghEndpoint(host, url)
    const method = (init.method ?? 'GET').toUpperCase()
    const stdin = typeof init.body === 'string' ? init.body : undefined
    const args = ['api', '--hostname', host, '--include', '--method', method]
    if (stdin !== undefined) {
      args.push('--header', `Content-Type: ${cliContentType(init.headers)}`, '--input', '-')
    }
    args.push(endpoint)
    const result = await run(args, stdin)
    return responseFromCli(result.stdout, result.code, 'gh')
  }
}

export type GitField = 'username' | 'password'

export function parseGitCredential(output: string, field: GitField): string | null {
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator > 0 && line.slice(0, separator) === field) {
      return line.slice(separator + 1) || null
    }
  }
  return null
}

// `gh auth git-credential` is the same helper that `gh auth setup-git` installs for git.
export async function ghGitCredential(
  host: string,
  field: GitField,
  run: GhRun = runGh,
): Promise<string | null> {
  if (!isSafeHttpsHost(host)) {
    return null
  }
  try {
    const result = await run(['auth', 'git-credential', 'get'], `protocol=https\nhost=${host}\n\n`)
    return result.code === 0 ? parseGitCredential(result.stdout, field) : null
  } catch {
    return null
  }
}
