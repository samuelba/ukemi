import type { ForgeKind, RequestBadge } from '../../shared/protocol'

export type MergeMethod = 'merge' | 'squash' | 'rebase'

export interface CreateRequestInput {
  head: string
  base: string
  title: string
  body: string
  isDraft: boolean
}

export interface ForgeClient {
  readonly kind: ForgeKind
  readonly host: string
  listRequests(branches: readonly string[], limit?: number): Promise<RequestBadge[]>
  createRequest(input: CreateRequestInput): Promise<RequestBadge>
  mergeRequest(number: number, method: MergeMethod): Promise<void>
}

export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>

export class ForgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'ForgeError'
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403
  }
}

const REQUEST_TIMEOUT_MS = 30_000

export async function requestJson(
  fetchImpl: HttpFetch,
  url: string,
  init: RequestInit & { token: string; authScheme: 'Bearer' | 'PRIVATE-TOKEN' },
): Promise<unknown> {
  const { token, authScheme, ...rest } = init
  const auth: Record<string, string> =
    authScheme === 'Bearer' ? { Authorization: `Bearer ${token}` } : { 'PRIVATE-TOKEN': token }
  const response = await fetchImpl(url, {
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
    throw new ForgeError(apiErrorMessage(body, response.status), response.status, body)
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
