import { describe, expect, test } from 'vitest'
import {
  parentBookmarkRevset,
  parentBookmarks,
  shouldPushBase,
  stackDetail,
} from '../../src/forge/requestBase'

function marked(...names: string[]): { localBookmarks: { name: string }[] } {
  return { localBookmarks: names.map((name) => ({ name })) }
}

describe('parentBookmarks', () => {
  test('returns nothing when no ancestor is bookmarked', () => {
    expect(parentBookmarks([], 'main', 'top')).toEqual([])
  })

  test('drops the trunk bookmark', () => {
    expect(parentBookmarks([marked('main', 'feature')], 'main', 'top')).toEqual(['feature'])
  })

  test('drops the head bookmark', () => {
    expect(parentBookmarks([marked('top', 'feature')], 'main', 'top')).toEqual(['feature'])
  })

  test('keeps every other bookmark on one ancestor', () => {
    expect(parentBookmarks([marked('feature', 'wip')], 'main', 'top')).toEqual(['feature', 'wip'])
  })

  test('keeps one bookmark from each head after a merge', () => {
    expect(parentBookmarks([marked('left'), marked('right')], 'main', 'top')).toEqual([
      'left',
      'right',
    ])
  })

  test('quotes the commit id in the revset', () => {
    expect(parentBookmarkRevset('abc123')).toBe('heads((::"abc123"- ~ ::trunk()) & bookmarks())')
  })
})

describe('stackDetail', () => {
  test('names the parent branch', () => {
    expect(stackDetail('feature', undefined)).toBe('Stacked on feature')
  })

  test('adds the open request number', () => {
    expect(stackDetail('feature', 12)).toBe('Stacked on feature (#12)')
  })
})

describe('shouldPushBase', () => {
  test('pushes a local bookmark that is not on the remote', () => {
    expect(shouldPushBase('feature', 'top', ['feature'], new Set())).toBe(true)
  })

  test('skips a bookmark that is already on the remote', () => {
    expect(shouldPushBase('feature', 'top', ['feature'], new Set(['feature']))).toBe(false)
  })

  test('skips a name that is not a local bookmark', () => {
    expect(shouldPushBase('feature', 'top', [], new Set())).toBe(false)
  })

  test('skips the head bookmark', () => {
    expect(shouldPushBase('top', 'top', ['top'], new Set())).toBe(false)
  })
})
