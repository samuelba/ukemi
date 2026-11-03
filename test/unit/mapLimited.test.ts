import { describe, expect, test } from 'vitest'
import { mapLimited } from '../../src/util/mapLimited'

describe('mapLimited', () => {
  test('keeps the order and runs at most `limit` at once', async () => {
    let running = 0
    let most = 0
    const result = await mapLimited([5, 1, 4, 2, 3], 2, async (value) => {
      running += 1
      most = Math.max(most, running)
      await new Promise((resolve) => setTimeout(resolve, value))
      running -= 1
      return value * 10
    })

    expect(result).toEqual([50, 10, 40, 20, 30])
    expect(most).toBe(2)
  })
})
