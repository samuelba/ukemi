import { describe, expect, it } from 'vitest'
import { cachingResolver, ElisionCache } from '../../src/graph/elisionCache'

describe('ElisionCache', () => {
  const day = new Date('2026-01-01T10:00:00Z')

  it('returns copies of remembered ancestors', () => {
    const cache = new ElisionCache()
    cache.remember('r', 'p', ['a'], day)
    const hit = cache.get('r', 'p', day) as string[]
    hit.push('x')
    expect(cache.get('r', 'p', day)).toEqual(['a'])
  })

  it('misses on a different revset, parent, or day, and after clear', () => {
    const cache = new ElisionCache()
    cache.remember('r', 'p', ['a'], day)
    expect(cache.get('r2', 'p', day)).toBeUndefined()
    expect(cache.get('r', 'p2', day)).toBeUndefined()
    expect(cache.get('r', 'p', new Date('2026-01-02T10:00:00Z'))).toBeUndefined()
    cache.clear()
    expect(cache.get('r', 'p', day)).toBeUndefined()
  })

  it('caches an empty result and resolves once', async () => {
    const cache = new ElisionCache()
    let calls = 0
    const resolve = cachingResolver(cache, 'r', async () => {
      calls += 1
      return []
    })
    await resolve('p')
    await resolve('p')
    expect(calls).toBe(1)
  })
})
