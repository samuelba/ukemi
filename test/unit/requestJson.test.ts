import { describe, expect, test } from 'vitest'
import { ForgeError, requestJson, type HttpFetch } from '../../src/forge/types'

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
