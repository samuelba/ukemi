import { beforeEach, describe, expect, test } from 'vitest'
import { cliAvailable, isSafeEndpoint, resetCliAvailability } from '../../src/forge/cli'

beforeEach(() => resetCliAvailability())

describe('cliAvailable', () => {
  test('is true when the binary runs, and is remembered', async () => {
    let runs = 0
    const run = async () => {
      runs++
      return { code: 0, stdout: '' }
    }

    expect(await cliAvailable('gh', run)).toBe(true)
    expect(await cliAvailable('gh', run)).toBe(true)
    expect(runs).toBe(1)
  })

  test('is false when the binary is missing, and is retried later', async () => {
    let runs = 0
    const missing = async () => {
      runs++
      throw Object.assign(new Error('spawn glab ENOENT'), { code: 'ENOENT' })
    }
    const present = async () => ({ code: 0, stdout: '' })

    expect(await cliAvailable('glab', missing, 1_000)).toBe(false)
    expect(await cliAvailable('glab', missing, 2_000)).toBe(false)
    expect(runs).toBe(1)
    expect(await cliAvailable('glab', present, 40_000)).toBe(true)
  })
})

describe('isSafeEndpoint', () => {
  test.each(['/user', '/repos/o/r/pulls?state=open'])('accepts %s', (endpoint) => {
    expect(isSafeEndpoint(endpoint)).toBe(true)
  })

  test.each(['user', '//evil', '/a\nb', '/a\0b', '/repos/{owner}/{repo}', '/a\\b'])(
    'rejects %j',
    (endpoint) => {
      expect(isSafeEndpoint(endpoint)).toBe(false)
    },
  )
})
