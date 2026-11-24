import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GitlabAuth, type OAuthRedirect } from '../../src/app/gitlabAuth'
import type { SecretStore } from '../../src/forge/secretStore'
import { NULL_LOGGER } from '../../src/util/logger'

const KEY = 'ukemi.gitlab.oauth.gitlab.com'

function session(token: string, expiresAt: number): string {
  return JSON.stringify({
    accessToken: `access-${token}`,
    refreshToken: `refresh-${token}`,
    expiresAt,
    clientId: 'client',
  })
}

function setup(stored: string) {
  const secrets = new Map([[KEY, stored]])
  const store: SecretStore = {
    get: async (key) => secrets.get(key),
    store: async (key, value) => void secrets.set(key, value),
    delete: async (key) => void secrets.delete(key),
  }
  const redirect: OAuthRedirect = {
    prepare: async () => 'http://127.0.0.1/callback',
    onDidRedirect: () => ({ dispose: () => undefined }),
    dispose: () => undefined,
  }
  const auth = new GitlabAuth(store, NULL_LOGGER, redirect, {} as never, {} as never)
  return { auth, secrets }
}

function answerRefresh(status: number, meanwhile: () => void = () => undefined) {
  vi.stubGlobal('fetch', async () => {
    meanwhile()
    return new Response(JSON.stringify({ error: 'invalid_grant' }), { status })
  })
}

function rejectRefresh(meanwhile?: () => void) {
  answerRefresh(400, meanwhile)
}

// Runs the call to the end, past the wait before a rejected session is deleted.
async function settled<T>(pending: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync()
  return pending
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout'] }))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('GitlabAuth refresh', () => {
  test('signs out when GitLab rejects the stored refresh token', async () => {
    const { auth, secrets } = setup(session('old', Date.now() - 1000))
    rejectRefresh()

    expect(await settled(auth.accessToken('gitlab.com'))).toBeNull()
    expect(secrets.has(KEY)).toBe(false)
  })

  test('keeps the session when the refresh fails for another reason', async () => {
    const stored = session('old', Date.now() - 1000)
    const { auth, secrets } = setup(stored)
    answerRefresh(500)

    expect(await settled(auth.accessToken('gitlab.com'))).toBeNull()
    expect(secrets.get(KEY)).toBe(stored)
  })

  test('keeps the session another window refreshed meanwhile', async () => {
    const { auth, secrets } = setup(session('old', Date.now() - 1000))
    const refreshed = session('new', Date.now() + 3_600_000)
    rejectRefresh(() => secrets.set(KEY, refreshed))

    expect(await settled(auth.accessToken('gitlab.com'))).toBe('access-new')
    expect(secrets.get(KEY)).toBe(refreshed)
  })

  test('keeps the session another window stores just after the rejection', async () => {
    const { auth, secrets } = setup(session('old', Date.now() - 1000))
    const refreshed = session('new', Date.now() + 3_600_000)
    rejectRefresh(() => setTimeout(() => secrets.set(KEY, refreshed), 100))

    expect(await settled(auth.accessToken('gitlab.com'))).toBe('access-new')
    expect(secrets.get(KEY)).toBe(refreshed)
  })
})
