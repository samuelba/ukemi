import { describe, expect, it } from 'vitest'
import { ElisionCache } from '../../src/graph/elisionCache'

describe('ElisionCache', () => {
  const day = new Date('2026-01-01T10:00:00Z')

  it('returns copies of remembered ancestors', () => {
    const cache = new ElisionCache()
    cache.remember('r', 'p', 'op1', ['a'], day)
    const hit = cache.lookup('r', 'p', 'op1', day)?.ancestors as string[]
    hit.push('x')
    expect(cache.lookup('r', 'p', 'op1', day)?.ancestors).toEqual(['a'])
  })

  it('misses on a different revset or parent, and after clear', () => {
    const cache = new ElisionCache()
    cache.remember('r', 'p', 'op1', ['a'], day)
    expect(cache.lookup('r2', 'p', 'op1', day)).toBeUndefined()
    expect(cache.lookup('r', 'p2', 'op1', day)).toBeUndefined()
    cache.clear()
    expect(cache.lookup('r', 'p', 'op1', day)).toBeUndefined()
  })

  it('offers an entry from another operation or day as stale', () => {
    const cache = new ElisionCache()
    cache.remember('r', 'p', 'op1', ['a'], day)
    expect(cache.lookup('r', 'p', 'op1', day)).toEqual({ ancestors: ['a'], fresh: true })
    expect(cache.lookup('r', 'p', 'op2', day)).toEqual({ ancestors: ['a'], fresh: false })
    expect(cache.lookup('r', 'p', 'op1', new Date('2026-01-02T10:00:00Z'))?.fresh).toBe(false)
    cache.remember('r', 'p', 'op2', ['b'], day)
    expect(cache.lookup('r', 'p', 'op2', day)).toEqual({ ancestors: ['b'], fresh: true })
    expect(cache.lookup('r', 'p', 'op1', day)?.fresh).toBe(false)
  })

  it('carries entries from one operation forward to the next', () => {
    const cache = new ElisionCache()
    cache.remember('r', 'p', 'op1', ['a'], day)
    cache.remember('r', 'q', 'op0', ['b'], day)
    cache.carryForward('op1', 'op2', day)
    expect(cache.lookup('r', 'p', 'op2', day)).toEqual({ ancestors: ['a'], fresh: true })
    // Only entries resolved at the earlier operation move.
    expect(cache.lookup('r', 'q', 'op2', day)?.fresh).toBe(false)
  })
})
