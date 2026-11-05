import { describe, expect, test } from 'vitest'
import {
  dropCommitAction,
  fileDropAction,
  insertCommitAction,
  insertEdge,
  insertGaps,
} from '../../webview/src/graph/dropCommit'

describe('dropCommitAction', () => {
  test('rebases the change and its descendants by default', () => {
    expect(dropCommitAction(false, false)).toEqual({ action: 'rebase', mode: 'source' })
  })

  test('limits a rebase to one change when Alt is held', () => {
    expect(dropCommitAction(false, true)).toEqual({ action: 'rebase', mode: 'revision' })
  })

  test('duplicates one change onto the target when Ctrl is held', () => {
    expect(dropCommitAction(true, false)).toEqual({ action: 'duplicate', mode: 'revision' })
  })

  test('duplicates a change and its descendants when Ctrl and Alt are held', () => {
    expect(dropCommitAction(true, true)).toEqual({ action: 'duplicate', mode: 'source' })
  })
})

describe('fileDropAction', () => {
  test('moves a file from a mutable change', () => {
    expect(fileDropAction(false, false)).toBe('move')
  })

  test('copies a file when Ctrl is held', () => {
    expect(fileDropAction(true, false)).toBe('copy')
  })

  test('copies a file out of an immutable change when Ctrl is held', () => {
    expect(fileDropAction(true, true)).toBe('copy')
  })

  test('refuses to move a file out of an immutable change', () => {
    expect(fileDropAction(false, true)).toBeNull()
  })
})

describe('insertCommitAction', () => {
  test('moves only the change by default', () => {
    expect(insertCommitAction(false, false)).toEqual({ action: 'rebase', mode: 'revision' })
  })

  test('brings the descendants along when Alt is held', () => {
    expect(insertCommitAction(false, true)).toEqual({ action: 'rebase', mode: 'source' })
  })

  test('duplicates one change when Ctrl is held', () => {
    expect(insertCommitAction(true, false)).toEqual({ action: 'duplicate', mode: 'revision' })
  })

  test('duplicates the change and its descendants when Ctrl and Alt are held', () => {
    expect(insertCommitAction(true, true)).toEqual({ action: 'duplicate', mode: 'source' })
  })
})

describe('insertEdge', () => {
  test('the top band is above', () => {
    expect(insertEdge(0, 24)).toBe('above')
    expect(insertEdge(5.9, 24)).toBe('above')
  })

  test('the middle drops onto the row', () => {
    expect(insertEdge(6, 24)).toBeNull()
    expect(insertEdge(12, 24)).toBeNull()
    expect(insertEdge(18, 24)).toBeNull()
  })

  test('the bottom band is below', () => {
    expect(insertEdge(18.1, 24)).toBe('below')
    expect(insertEdge(24, 24)).toBe('below')
  })

  test('a tall row keeps a fixed band', () => {
    expect(insertEdge(100, 200)).toBeNull()
    expect(insertEdge(196, 200)).toBe('below')
  })

  test('a short row keeps a middle', () => {
    expect(insertEdge(8, 16)).toBeNull()
    expect(insertEdge(3, 16)).toBe('above')
  })
})

describe('insertGaps', () => {
  const row = (commitId: string, parents: string[], isImmutable = false) => ({
    commitId,
    parents,
    isImmutable,
  })

  test('joins a parent and child that are adjacent', () => {
    const gaps = insertGaps([row('c', ['b']), row('b', ['a']), row('a', [], true)])

    expect(gaps).toEqual([
      { above: null, below: 'b' },
      { above: 'c', below: 'a' },
      { above: 'b', below: null },
    ])
  })

  test('has no gap between rows on different branches', () => {
    const gaps = insertGaps([row('x', ['a']), row('b', ['a']), row('a', [])])

    expect(gaps[0]).toEqual({ above: null, below: null })
    expect(gaps[1]).toEqual({ above: null, below: 'a' })
  })

  test('has no gap under an immutable child', () => {
    const gaps = insertGaps([row('b', ['a'], true), row('a', [], true)])

    expect(gaps).toEqual([
      { above: null, below: null },
      { above: null, below: null },
    ])
  })
})
