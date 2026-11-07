import { describe, expect, test } from 'vitest'
import { fileLabel, statusWords } from '../../webview/src/graph/rowStatus'

const plain = {
  isWorkingCopy: false,
  hasConflict: false,
  isImmutable: false,
  isDivergent: false,
  isHidden: false,
  isEmpty: false,
  isMine: true,
}

describe('statusWords', () => {
  test('says nothing for a plain change of mine', () => {
    expect(statusWords(plain)).toEqual([])
  })

  test('names the working copy', () => {
    expect(statusWords({ ...plain, isWorkingCopy: true, isEmpty: true })).toEqual([
      'working copy',
      'empty',
    ])
  })

  test('names each state the node shape shows', () => {
    expect(
      statusWords({
        isWorkingCopy: false,
        hasConflict: true,
        isImmutable: true,
        isDivergent: true,
        isHidden: true,
        isEmpty: false,
        isMine: false,
      }),
    ).toEqual(['conflict', 'immutable', 'divergent', 'hidden', "someone else's"])
  })
})

describe('fileLabel', () => {
  test('spells out the status', () => {
    expect(fileLabel({ path: 'src/a.ts', status: 'added', isConflicted: false })).toBe(
      'src/a.ts, added',
    )
    expect(fileLabel({ path: 'b', status: 'removed', isConflicted: false })).toBe('b, removed')
  })

  test('a conflict wins over the status', () => {
    expect(fileLabel({ path: 'c', status: 'modified', isConflicted: true })).toBe('c, conflicted')
  })
})
