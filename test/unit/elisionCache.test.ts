import { describe, expect, it } from 'vitest'
import { cachingResolver, ElisionCache } from '../../src/graph/elisionCache'

describe('ElisionCache', () => {
  const day = new Date('2026-01-01T10:00:00Z')

  it('returns copies of remembered ancestors', () => {
    const cache = new ElisionCache()
    cache.remember('r', 'p', 'op1', ['a'], day)
    const hit = cache.get('r', 'p', 'op1', day) as string[]
    hit.push('x')
    expect(cache.get('r', 'p', 'op1', day)).toEqual(['a'])
  })

  it('misses on a different revset, parent, operation, or day, and after clear', () => {
    const cache = new ElisionCache()
    cache.remember('r', 'p', 'op1', ['a'], day)
    expect(cache.get('r2', 'p', 'op1', day)).toBeUndefined()
    expect(cache.get('r', 'p2', 'op1', day)).toBeUndefined()
    expect(cache.get('r', 'p', 'op2', day)).toBeUndefined()
    expect(cache.get('r', 'p', 'op1', new Date('2026-01-02T10:00:00Z'))).toBeUndefined()
    cache.clear()
    expect(cache.get('r', 'p', 'op1', day)).toBeUndefined()
  })

  it('offers an entry from an earlier operation as stale until it is resolved again', () => {
    const cache = new ElisionCache()
    cache.remember('r', 'p', 'op1', ['a'], day)
    expect(cache.lookup('r', 'p', 'op1', day)).toEqual({ ancestors: ['a'], fresh: true })
    expect(cache.lookup('r', 'p', 'op2', day)).toEqual({ ancestors: ['a'], fresh: false })
    cache.remember('r', 'p', 'op2', ['b'], day)
    expect(cache.lookup('r', 'p', 'op2', day)).toEqual({ ancestors: ['b'], fresh: true })
    expect(cache.lookup('r', 'p', 'op1', day)?.fresh).toBe(false)
  })

  it('carries entries from one operation forward to the next', () => {
    const cache = new ElisionCache()
    cache.remember('r', 'p', 'op1', ['a'], day)
    cache.remember('r', 'q', 'op0', ['b'], day)
    cache.carryForward('op1', 'op2', day)
    expect(cache.get('r', 'p', 'op2', day)).toEqual(['a'])
    // Only entries resolved at the earlier operation move.
    expect(cache.lookup('r', 'q', 'op2', day)?.fresh).toBe(false)
  })

  it('caches an empty result and resolves once per operation', async () => {
    const cache = new ElisionCache()
    let calls = 0
    const counting = async (): Promise<string[]> => {
      calls += 1
      return []
    }
    const resolve = cachingResolver(cache, 'r', 'op1', counting)
    await resolve('p')
    await resolve('p')
    expect(calls).toBe(1)
    await cachingResolver(cache, 'r', 'op2', counting)('p')
    expect(calls).toBe(2)
  })
})
