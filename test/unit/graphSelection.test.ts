import { describe, expect, test } from 'vitest'
import { selectedRow } from '../../webview/src/graph/selection'

const commits = [
  { commitId: 'c-wc-2', changeId: 'wc', isWorkingCopy: true },
  { commitId: 'c-a', changeId: 'a', isWorkingCopy: false },
]

describe('selectedRow', () => {
  test('keeps the selected commit', () => {
    expect(selectedRow(commits, { commitId: 'c-a', changeId: 'a' })).toBe('c-a')
  })

  test('follows the change when a snapshot gave it a new commit', () => {
    expect(selectedRow(commits, { commitId: 'c-wc-1', changeId: 'wc' })).toBe('c-wc-2')
  })

  test('selects the working copy when nothing is selected', () => {
    expect(selectedRow(commits, null)).toBe('c-wc-2')
  })

  test('selects nothing when the selected change is gone', () => {
    expect(selectedRow(commits, { commitId: 'c-x', changeId: 'x' })).toBeNull()
  })
})
