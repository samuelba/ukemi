import { describe, expect, test } from 'vitest'
import { dropCommitAction, fileDropAction } from '../../webview/src/graph/dropCommit'

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
