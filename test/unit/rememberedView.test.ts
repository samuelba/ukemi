import { describe, expect, test } from 'vitest'
import type { KeyValueStore } from '../../src/app/host'
import {
  readRevsetHistory,
  readView,
  rememberRevset,
  rememberView,
  type GraphView,
} from '../../src/app/rememberedView'

const DEFAULTS: GraphView = { filter: 'recent', depth: '7d' }

function memoryStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const values = new Map(Object.entries(initial))
  return {
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: async (key, value) => {
      values.set(key, value)
    },
  }
}

describe('remembered view', () => {
  test('keeps the filter and depth of each repository apart', async () => {
    const store = memoryStore()
    await rememberView(store, '/a', { filter: 'mine', depth: '30d' }, DEFAULTS)
    expect(readView(store, '/a', DEFAULTS)).toEqual({ filter: 'mine', depth: '30d' })
    expect(readView(store, '/b', DEFAULTS)).toBeNull()
  })

  test('forgets the view once the default filter or depth changes in the settings', async () => {
    const store = memoryStore()
    await rememberView(store, '/a', { filter: 'mine', depth: '30d' }, DEFAULTS)
    expect(readView(store, '/a', { filter: 'recent', depth: 'all' })).toBeNull()
  })

  test('ignores a stored view it does not understand', () => {
    const store = memoryStore({
      'ukemi.view:/a': { filter: 'everything', depth: '30d', defaults: DEFAULTS },
    })
    expect(readView(store, '/a', DEFAULTS)).toBeNull()
    expect(readView(memoryStore({ 'ukemi.view:/a': 'mine' }), '/a', DEFAULTS)).toBeNull()
  })

  test('keeps a typed revset with the view', async () => {
    const store = memoryStore()
    await rememberView(store, '/a', { filter: 'recent', depth: '7d', revset: 'mine()' }, DEFAULTS)
    expect(readView(store, '/a', DEFAULTS)).toEqual({
      filter: 'recent',
      depth: '7d',
      revset: 'mine()',
    })
  })

  test('ignores a stored revset that is not a non-empty string', () => {
    const stored = (revset: unknown) =>
      memoryStore({
        'ukemi.view:/a': { filter: 'recent', depth: '7d', revset, defaults: DEFAULTS },
      })
    expect(readView(stored(' '), '/a', DEFAULTS)).toBeNull()
    expect(readView(stored(3), '/a', DEFAULTS)).toBeNull()
  })

  test('keeps the latest revsets first, without repeats, up to 20', async () => {
    const store = memoryStore()
    for (let i = 0; i < 25; i++) {
      await rememberRevset(store, '/a', `r${i}`)
    }
    await rememberRevset(store, '/a', 'r20')
    const history = readRevsetHistory(store, '/a')
    expect(history).toHaveLength(20)
    expect(history.slice(0, 3)).toEqual(['r20', 'r24', 'r23'])
    expect(readRevsetHistory(store, '/b')).toEqual([])
  })
})
