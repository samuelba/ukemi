import { describe, expect, test } from 'vitest'
import type { CleanupBookmark, CleanupSnapshot } from '../../shared/cleanup'
import { carriedChoices, type CleanupChoices } from '../../webview/src/cleanup/carriedSelection'

function bookmark(
  name: string,
  checked: boolean,
  abandonCommitIds: string[] = [],
): CleanupBookmark {
  return {
    name,
    reason: 'merged',
    detail: 'Merged into main.',
    description: name,
    checked,
    hasGitRemote: true,
    abandonCommitIds,
  }
}

function snapshot(bookmarks: CleanupBookmark[]): CleanupSnapshot {
  return {
    bookmarks,
    deletedBookmarks: [],
    workspaces: [],
    divergent: [],
    undescribed: [],
    undescribedTruncated: false,
  }
}

const none: CleanupChoices = {
  bookmarks: new Set(),
  abandonCommits: new Set(),
  deleted: new Set(),
  deleteRemote: new Set(),
  workspaces: new Set(),
  deleteFiles: new Set(),
  drops: new Set(),
  undescribedDrops: new Set(),
}

describe('carriedChoices', () => {
  test('takes the defaults for the first snapshot', () => {
    const first = snapshot([bookmark('a', true), bookmark('b', false)])
    expect([...carriedChoices(none, null, first).bookmarks]).toEqual(['a'])
  })

  test('keeps what the user changed on items that did not change', () => {
    const before = snapshot([bookmark('a', true, ['c1']), bookmark('b', false)])
    const chosen = { ...none, bookmarks: new Set(['b']), abandonCommits: new Set(['b']) }
    const after = snapshot([bookmark('a', true, ['c1']), bookmark('b', false), bookmark('n', true)])

    const carried = carriedChoices(chosen, before, after)

    expect([...carried.bookmarks].sort()).toEqual(['b', 'n'])
    expect([...carried.abandonCommits]).toEqual(['b'])
  })

  test('resets an item that changed, and what depends on it', () => {
    const before = snapshot([bookmark('a', false, ['c1'])])
    const chosen = { ...none, bookmarks: new Set(['a']), abandonCommits: new Set(['a']) }
    const after = snapshot([bookmark('a', false, ['c1', 'c2'])])

    const carried = carriedChoices(chosen, before, after)

    expect(carried.bookmarks.size).toBe(0)
    expect(carried.abandonCommits.size).toBe(0)
  })

  test('drops choices for items that are gone', () => {
    const before = snapshot([bookmark('a', false)])
    const chosen = { ...none, bookmarks: new Set(['a']) }
    expect(carriedChoices(chosen, before, snapshot([])).bookmarks.size).toBe(0)
  })
})
