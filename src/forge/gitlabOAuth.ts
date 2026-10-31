import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { isSafeHttpsHost } from './hostName'
import type { HttpFetch } from './types'

export const OAUTH_REFRESH_SKEW_MS = 60_000
const DEFAULT_EXPIRES_IN_SECONDS = 7200
const REVOKE_TIMEOUT_MS = 10_000

export class GitlabOAuthError extends Error {
  constructor(readonly status: number) {
    super(`GitLab OAuth failed: HTTP ${status}`)
    this.name = 'GitlabOAuthError'
  }

  get isRejected(): boolean {
    return this.status === 400 || this.status === 401 || this.status === 403
  }
}

export interface GitlabOAuthSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
  clientId: string
}

export interface PkcePair {
  verifier: string
  challenge: string
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().optional(),
  created_at: z.number().optional(),
})

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function gitlabClientId(
  host: string,
  apps: Readonly<Record<string, string>>,
): string | null {
  const match = Object.entries(apps).find(([name]) => name.toLowerCase() === host.toLowerCase())
  const value = match?.[1]?.trim()
  return value || null
}

export function gitlabAuthorizeUrl(input: {
  host: string
  clientId: string
  redirectUri: string
  state: string
  challenge: string
}): string {
  if (!isSafeHttpsHost(input.host)) {
    throw new Error('Invalid GitLab host')
  }
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    state: input.state,
    scope: 'api',
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
  })
  return `https://${input.host}/oauth/authorize?${params}`
}

export function sessionNeedsRefresh(session: GitlabOAuthSession, now: number): boolean {
  return session.expiresAt - now <= OAUTH_REFRESH_SKEW_MS
}

export async function exchangeGitlabCode(
  fetchImpl: HttpFetch,
  input: {
    host: string
    clientId: string
    code: string
    redirectUri: string
    verifier: string
    now?: number
  },
): Promise<GitlabOAuthSession> {
  return requestToken(
    fetchImpl,
    input.host,
    {
      client_id: input.clientId,
      code: input.code,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    },
    input.clientId,
    null,
    input.now ?? Date.now(),
  )
}

export async function revokeGitlabToken(
  fetchImpl: HttpFetch,
  input: { host: string; clientId: string; token: string },
): Promise<void> {
  if (!isSafeHttpsHost(input.host)) {
    throw new Error('Invalid GitLab host')
  }
  const response = await fetchImpl(`https://${input.host}/oauth/revoke`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: input.clientId, token: input.token }).toString(),
    redirect: 'error',
    signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new GitlabOAuthError(response.status)
  }
}

export async function refreshGitlabToken(
  fetchImpl: HttpFetch,
  input: {
    host: string
    clientId: string
    refreshToken: string
    now?: number
  },
): Promise<GitlabOAuthSession> {
  const previous: GitlabOAuthSession = {
    accessToken: '',
    refreshToken: input.refreshToken,
    expiresAt: 0,
    clientId: input.clientId,
  }
  return requestToken(
    fetchImpl,
    input.host,
    {
      client_id: input.clientId,
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
    },
    input.clientId,
    previous,
    input.now ?? Date.now(),
  )
}

async function requestToken(
  fetchImpl: HttpFetch,
  host: string,
  body: Record<string, string>,
  clientId: string,
  previous: GitlabOAuthSession | null,
  now: number,
): Promise<GitlabOAuthSession> {
  if (!isSafeHttpsHost(host)) {
    throw new Error('Invalid GitLab host')
  }
  const response = await fetchImpl(`https://${host}/oauth/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    redirect: 'error',
  })
  const text = await response.text()
  if (!response.ok) {
    throw new GitlabOAuthError(response.status)
  }
  const parsed = tokenResponseSchema.parse(text ? JSON.parse(text) : {})
  const refreshToken = parsed.refresh_token ?? previous?.refreshToken
  if (!refreshToken) {
    throw new Error('GitLab token response has no refresh token')
  }
  const createdMs = (parsed.created_at ?? Math.floor(now / 1000)) * 1000
  const expiresIn = parsed.expires_in ?? DEFAULT_EXPIRES_IN_SECONDS
  return {
    accessToken: parsed.access_token,
    refreshToken,
    expiresAt: createdMs + expiresIn * 1000,
    clientId,
  }
}
