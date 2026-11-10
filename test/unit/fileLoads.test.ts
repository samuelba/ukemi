import { describe, expect, test } from 'vitest'
import { fileKey, isFailed, keepKeys } from '../../webview/src/graph/fileLoads'

describe('keepKeys', () => {
  test('drops the entries whose key is not kept', () => {
    const map = new Map([
      ['a', 1],
      ['b', 2],
    ])
    expect([...keepKeys(map, new Set(['b', 'c']))]).toEqual([['b', 2]])
  })

  test('gives the same map back when every entry is kept', () => {
    const map = new Map([['a', 1]])
    expect(keepKeys(map, new Set(['a', 'b']))).toBe(map)
  })
})

describe('isFailed', () => {
  test('tells a failed load from a file list and from no answer yet', () => {
    expect(isFailed({ error: 'jj timed out' })).toBe(true)
    expect(isFailed([])).toBe(false)
    expect(isFailed(undefined)).toBe(false)
  })
})

test('fileKey keeps the same commit in two repos apart', () => {
  expect(fileKey('/a', 'c1')).not.toBe(fileKey('/b', 'c1'))
})
