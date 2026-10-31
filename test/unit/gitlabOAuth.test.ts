import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import {
  createPkcePair,
  exchangeGitlabCode,
  GitlabOAuthError,
  gitlabAuthorizeUrl,
  gitlabClientId,
  refreshGitlabToken,
  revokeGitlabToken,
  sessionNeedsRefresh,
  OAUTH_REFRESH_SKEW_MS,
} from '../../src/forge/gitlabOAuth'
import type { HttpFetch } from '../../src/forge/types'

describe('GitLab OAuth', () => {
  test('builds an S256 challenge and an authorize URL', () => {
    const pair = createPkcePair()
    const expected = createHash('sha256').update(pair.verifier).digest('base64url')

    expect(pair.challenge).toBe(expected)
    expect(
      gitlabAuthorizeUrl({
        host: 'git.anybotics.com',
        clientId: 'app',
        redirectUri: 'cursor://samuelba.ukemi-jj/gitlab-auth',
        state: 'state 1',
        challenge: pair.challenge,
      }),
    ).toBe(
      `https://git.anybotics.com/oauth/authorize?client_id=app&redirect_uri=cursor%3A%2F%2Fsamuelba.ukemi-jj%2Fgitlab-auth&response_type=code&state=state+1&scope=api&code_challenge=${pair.challenge}&code_challenge_method=S256`,
    )
    expect(() =>
      gitlabAuthorizeUrl({
        host: 'bad host',
        clientId: 'app',
        redirectUri: 'cursor://samuelba.ukemi-jj/gitlab-auth',
        state: 's',
        challenge: 'c',
      }),
    ).toThrow('Invalid GitLab host')
  })

  test('matches a client id by host', () => {
    expect(gitlabClientId('Git.anybotics.com', { 'git.anybotics.com': ' abc ' })).toBe('abc')
    expect(gitlabClientId('gitlab.com', {})).toBeNull()
  })

  test('exchanges a code and refreshes before expiry', async () => {
    const calls: { url: string; body: string }[] = []
    const fetchImpl: HttpFetch = async (url, init) => {
      calls.push({ url, body: String(init.body) })
      const grant = new URLSearchParams(String(init.body)).get('grant_type')
      const payload =
        grant === 'refresh_token'
          ? { access_token: 'next', expires_in: 7200, created_at: 100 }
          : { access_token: 'first', refresh_token: 'refresh', expires_in: 7200, created_at: 50 }
      return new Response(JSON.stringify(payload), { status: 200 })
    }

    const session = await exchangeGitlabCode(fetchImpl, {
      host: 'gitlab.com',
      clientId: 'app',
      code: 'code',
      redirectUri: 'vscode://samuelba.ukemi-jj/gitlab-auth',
      verifier: 'verifier',
      now: 60_000,
    })

    expect(session).toEqual({
      accessToken: 'first',
      refreshToken: 'refresh',
      expiresAt: 50_000 + 7200 * 1000,
      clientId: 'app',
    })
    expect(calls[0]?.body).toContain('code_verifier=verifier')
    expect(sessionNeedsRefresh(session, session.expiresAt - OAUTH_REFRESH_SKEW_MS)).toBe(true)
    expect(sessionNeedsRefresh(session, session.expiresAt - OAUTH_REFRESH_SKEW_MS - 1)).toBe(false)

    const refreshed = await refreshGitlabToken(fetchImpl, {
      host: 'gitlab.com',
      clientId: 'app',
      refreshToken: session.refreshToken,
    })

    expect(refreshed.accessToken).toBe('next')
    expect(refreshed.refreshToken).toBe('refresh')
    expect(calls[1]?.body).toContain('grant_type=refresh_token')
  })

  test('rejects a failed token response without reading a new session', async () => {
    const fetchImpl: HttpFetch = async () => new Response('nope', { status: 401 })

    const error = await exchangeGitlabCode(fetchImpl, {
      host: 'gitlab.com',
      clientId: 'app',
      code: 'code',
      redirectUri: 'vscode://samuelba.ukemi-jj/gitlab-auth',
      verifier: 'verifier',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GitlabOAuthError)
    expect((error as GitlabOAuthError).isRejected).toBe(true)
    expect((error as GitlabOAuthError).message).toBe('GitLab OAuth failed: HTTP 401')
    expect(new GitlabOAuthError(500).isRejected).toBe(false)
  })
})

describe('revokeGitlabToken', () => {
  test('posts the token and client id to the revoke endpoint', async () => {
    const calls: Array<{ url: string; body: string }> = []
    const fetchImpl: HttpFetch = async (url, init) => {
      calls.push({ url, body: String(init.body) })
      return new Response('{}', { status: 200 })
    }

    await revokeGitlabToken(fetchImpl, { host: 'git.example.com', clientId: 'app', token: 'r1' })

    expect(calls).toEqual([
      { url: 'https://git.example.com/oauth/revoke', body: 'client_id=app&token=r1' },
    ])
  })

  test('rejects an unsafe host and a failed response', async () => {
    const failing: HttpFetch = async () => new Response('{}', { status: 400 })
    await expect(
      revokeGitlabToken(failing, { host: 'bad host', clientId: 'a', token: 't' }),
    ).rejects.toThrow('Invalid GitLab host')
    await expect(
      revokeGitlabToken(failing, { host: 'git.example.com', clientId: 'a', token: 't' }),
    ).rejects.toBeInstanceOf(GitlabOAuthError)
  })
})
