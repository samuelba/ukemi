import type { CommitCi, ForgeKind, RequestBadge } from '../../shared/protocol'

export type MergeMethod = 'merge' | 'squash' | 'rebase'
export type MergeOutcome = 'merged' | 'enqueued'

export interface CreateRequestInput {
  head: string
  base: string
  title: string
  body: string
  isDraft: boolean
}

export type NativeStackResult = 'created' | 'extended' | 'unchanged' | 'unavailable' | 'diverged'

export interface ForgeClient {
  readonly kind: ForgeKind
  readonly host: string
  listRequests(branches: readonly string[], limit?: number): Promise<RequestBadge[]>
  createRequest(input: CreateRequestInput): Promise<RequestBadge>
  mergeRequest(number: number, method: MergeMethod): Promise<MergeOutcome>
  updateRequestBase(number: number, base: string): Promise<void>
  syncNativeStack?(numbers: readonly number[]): Promise<NativeStackResult>
  // The CI of a pushed commit. Null when the forge does not know the commit.
  commitCi?(commitId: string): Promise<CommitCi | null>
}

export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>

export class ForgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
    // How long the forge asks to wait, when it sent a rate limit header.
    readonly retryAfterMs: number | null = null,
  ) {
    super(message)
    this.name = 'ForgeError'
  }

  // GitHub answers 403 for a used-up or secondary rate limit, GitLab 429.
  get isRateLimited(): boolean {
    return (
      this.status === 429 ||
      (this.status === 403 && (this.retryAfterMs !== null || /rate limit/i.test(this.message)))
    )
  }

  get isAuthError(): boolean {
    return (this.status === 401 || this.status === 403) && !this.isRateLimited
  }
}

// Reads `Retry-After`, or the reset time of a used-up limit: GitHub's `x-ratelimit-*` and GitLab's
// `ratelimit-*` headers.
export function retryAfterMs(headers: Headers, now = Date.now()): number | null {
  const retryAfter = headers.get('retry-after')
  if (retryAfter !== null) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000)
    }
    const date = Date.parse(retryAfter)
    return Number.isNaN(date) ? null : Math.max(0, date - now)
  }
  const remaining = headers.get('x-ratelimit-remaining') ?? headers.get('ratelimit-remaining')
  const reset = Number(headers.get('x-ratelimit-reset') ?? headers.get('ratelimit-reset'))
  if (remaining === '0' && reset > 0) {
    return Math.max(0, reset * 1000 - now)
  }
  return null
}

const REQUEST_TIMEOUT_MS = 30_000

const MAX_REDIRECTS = 3

// Custom auth headers such as PRIVATE-TOKEN survive cross-origin redirects, so redirects are
// followed by hand and only within the original origin.
async function fetchSameOrigin(
  fetchImpl: HttpFetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const origin = new URL(url).origin
  let target = url
  let current = init
  for (let hops = 0; ; hops++) {
    const response = await fetchImpl(target, { ...current, redirect: 'manual' })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) {
      return response
    }
    const next = new URL(location, target)
    if (next.origin !== origin || hops >= MAX_REDIRECTS) {
      throw new ForgeError(`Refused to follow a redirect to ${next.origin}`, response.status)
    }
    target = next.toString()
    const keepsMethod = response.status === 307 || response.status === 308
    const method = (current.method ?? 'GET').toUpperCase()
    if (!keepsMethod && method !== 'GET' && method !== 'HEAD') {
      current = { ...current, method: 'GET', body: null }
    }
  }
}

export async function requestJson(
  fetchImpl: HttpFetch,
  url: string,
  init: RequestInit & { token: string; authScheme: 'Bearer' | 'PRIVATE-TOKEN' },
): Promise<unknown> {
  const { token, authScheme, ...rest } = init
  const auth: Record<string, string> =
    authScheme === 'Bearer' ? { Authorization: `Bearer ${token}` } : { 'PRIVATE-TOKEN': token }
  const response = await fetchSameOrigin(fetchImpl, url, {
    ...rest,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'ukemi-vscode',
      ...auth,
      ...(rest.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const text = await response.text()
  const body: unknown = text ? safeJson(text) : null
  if (!response.ok) {
    throw new ForgeError(
      apiErrorMessage(body, response.status),
      response.status,
      body,
      retryAfterMs(response.headers),
    )
  }
  return body
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function apiErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    const message = record.message ?? record.error ?? record.errors
    if (message !== undefined) {
      return `HTTP ${status}: ${typeof message === 'string' ? message : JSON.stringify(message)}`
    }
  }
  return `HTTP ${status}`
}
