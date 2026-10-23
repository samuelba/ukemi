import { describe, expect, test } from 'vitest'
import { dropCommitAction } from '../../webview/src/graph/dropCommit'

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
