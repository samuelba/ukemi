import { describe, expect, test } from 'vitest'
import { shouldReload } from '../../src/desktop/rendererRecovery'

describe('shouldReload', () => {
  test('reloads a page until it crashed three times within a minute', () => {
    expect(shouldReload([], 100_000)).toBe(true)
    expect(shouldReload([90_000, 95_000], 100_000)).toBe(true)
    expect(shouldReload([90_000, 95_000, 99_000], 100_000)).toBe(false)
  })

  test('forgets crashes older than a minute', () => {
    expect(shouldReload([10_000, 20_000, 30_000], 100_000)).toBe(true)
  })
})
