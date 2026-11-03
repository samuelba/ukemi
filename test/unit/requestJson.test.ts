import { describe, expect, test } from 'vitest'
import { rateLimitPause } from '../../src/forge/refreshInterval'
import { ForgeError, requestJson, retryAfterMs, type HttpFetch } from '../../src/forge/types'

function redirect(status: number, location: string): Response {
  return new Response(null, { status, headers: { location } })
}

function recorder(responses: Response[]) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchImpl: HttpFetch = async (url, init) => {
    calls.push({ url, init })
    const next = responses.shift()
    if (!next) {
      throw new Error('unexpected request')
    }
    return next
  }
  return { calls, fetchImpl }
}

const AUTH = { token: 't', authScheme: 'PRIVATE-TOKEN' as const }

describe('requestJson redirects', () => {
  test('follows a redirect within the same origin', async () => {
    const { calls, fetchImpl } = recorder([
      redirect(301, '/api/v4/projects/7'),
      new Response('{"ok":true}', { status: 200 }),
    ])

    await expect(requestJson(fetchImpl, 'https://git.example.com/api/v4/p', AUTH)).resolves.toEqual(
      { ok: true },
    )
    expect(calls.map((call) => call.url)).toEqual([
      'https://git.example.com/api/v4/p',
      'https://git.example.com/api/v4/projects/7',
    ])
    expect(calls.every((call) => call.init.redirect === 'manual')).toBe(true)
  })

  test('refuses to send the token to another origin', async () => {
    const { calls, fetchImpl } = recorder([redirect(302, 'https://evil.example/steal')])

    await expect(
      requestJson(fetchImpl, 'https://git.example.com/api/v4/p', AUTH),
    ).rejects.toBeInstanceOf(ForgeError)
    expect(calls).toHaveLength(1)
  })

  test('refuses a redirect loop', async () => {
    const { fetchImpl } = recorder(Array.from({ length: 10 }, () => redirect(302, '/again')))

    await expect(requestJson(fetchImpl, 'https://git.example.com/x', AUTH)).rejects.toThrow(
      'Refused to follow',
    )
  })

  test('keeps the body on 307 and drops it on 302', async () => {
    const keeps = recorder([redirect(307, '/b'), new Response('{}', { status: 200 })])
    await requestJson(keeps.fetchImpl, 'https://h.example.com/a', {
      ...AUTH,
      method: 'POST',
      body: 'x',
    })
    expect(keeps.calls[1]?.init).toMatchObject({ method: 'POST', body: 'x' })

    const drops = recorder([redirect(302, '/b'), new Response('{}', { status: 200 })])
    await requestJson(drops.fetchImpl, 'https://h.example.com/a', {
      ...AUTH,
      method: 'POST',
      body: 'x',
    })
    expect(drops.calls[1]?.init.method).toBe('GET')
    expect(drops.calls[1]?.init.body).toBeNull()
  })
})

describe('rate limits', () => {
  test('reads a used-up GitHub limit and tells it apart from a login problem', async () => {
    const { fetchImpl } = recorder([
      new Response('{"message":"API rate limit exceeded"}', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1100' },
      }),
    ])
    const error = await requestJson(fetchImpl, 'https://api.github.com/x', AUTH).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(ForgeError)
    const forgeError = error as ForgeError
    expect(forgeError.isRateLimited).toBe(true)
    expect(forgeError.isAuthError).toBe(false)
  })

  test('reads Retry-After in seconds or as a date', () => {
    expect(retryAfterMs(new Headers({ 'retry-after': '30' }), 0)).toBe(30_000)
    expect(retryAfterMs(new Headers({ 'retry-after': 'Thu, 01 Jan 1970 00:01:00 GMT' }), 0)).toBe(
      60_000,
    )
    expect(
      retryAfterMs(new Headers({ 'ratelimit-remaining': '0', 'ratelimit-reset': '5' }), 0),
    ).toBe(5_000)
    expect(retryAfterMs(new Headers({ 'x-ratelimit-remaining': '10' }), 0)).toBeNull()
  })

  test('counts a GitLab 429 and a GitHub secondary limit as rate limits', () => {
    expect(new ForgeError('HTTP 429', 429).isRateLimited).toBe(true)
    expect(
      new ForgeError('HTTP 403: You have exceeded a secondary rate limit', 403).isRateLimited,
    ).toBe(true)
    expect(new ForgeError('HTTP 403: Resource not accessible', 403).isAuthError).toBe(true)
  })

  test('pauses for the time the forge asks, or longer with each refusal', () => {
    expect(rateLimitPause(120_000, 1)).toBe(120_000)
    expect(rateLimitPause(null, 1)).toBe(60_000)
    expect(rateLimitPause(null, 3)).toBe(240_000)
    expect(rateLimitPause(null, 20)).toBe(60 * 60_000)
  })
})
