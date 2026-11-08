import { describe, expect, test } from 'vitest'
import type { CleanupSnapshot } from '../../shared/cleanup'
import {
  cleanupReducer,
  countOf,
  INITIAL_CLEANUP,
  NO_CHOICES,
  selectionOf,
  type CleanupAction,
  type CleanupState,
} from '../../webview/src/cleanup/cleanupChoices'

function run(...actions: CleanupAction[]): CleanupState {
  return actions.reduce(cleanupReducer, INITIAL_CLEANUP)
}

const names = (set: ReadonlySet<string>) => [...set].sort()

describe('paired checkboxes', () => {
  test('unchecking a bookmark clears its abandon commits', () => {
    const { choices } = run(
      { type: 'bookmark', name: 'a', selected: true },
      { type: 'abandonCommits', name: 'a', selected: true },
      { type: 'bookmark', name: 'a', selected: false },
    )
    expect(names(choices.bookmarks)).toEqual([])
    expect(names(choices.abandonCommits)).toEqual([])
  })

  test('deleting the remote checks the deleted bookmark, and unchecking that clears it', () => {
    const checked = run({ type: 'deleteRemote', name: 'b', selected: true })
    expect(names(checked.choices.deleted)).toEqual(['b'])
    const cleared = cleanupReducer(checked, { type: 'deleted', name: 'b', selected: false })
    expect(names(cleared.choices.deleteRemote)).toEqual([])
  })

  test('unchecking delete remote keeps the deleted bookmark', () => {
    const { choices } = run(
      { type: 'deleteRemote', name: 'b', selected: true },
      { type: 'deleteRemote', name: 'b', selected: false },
    )
    expect(names(choices.deleted)).toEqual(['b'])
  })

  test('deleting the files checks the workspace, and unchecking that clears them', () => {
    const checked = run({ type: 'deleteFiles', name: 'w', selected: true })
    expect(names(checked.choices.workspaces)).toEqual(['w'])
    const cleared = cleanupReducer(checked, { type: 'workspace', name: 'w', selected: false })
    expect(names(cleared.choices.deleteFiles)).toEqual([])
  })

  test('commit choices toggle on their own', () => {
    const { choices } = run(
      { type: 'drop', commitId: 'c1', selected: true },
      { type: 'undescribed', commitId: 'c2', selected: true },
    )
    expect(names(choices.drops)).toEqual(['c1'])
    expect(names(choices.undescribedDrops)).toEqual(['c2'])
  })

  test('does not change the previous state', () => {
    const before = run({ type: 'bookmark', name: 'a', selected: true })
    cleanupReducer(before, { type: 'bookmark', name: 'b', selected: true })
    expect(names(before.choices.bookmarks)).toEqual(['a'])
  })
})

describe('selectionOf and countOf', () => {
  test('an option counts only while its row is checked', () => {
    const choices = {
      ...NO_CHOICES,
      bookmarks: new Set(['a']),
      abandonCommits: new Set(['a', 'stale']),
      deleted: new Set<string>(),
      deleteRemote: new Set(['x']),
      workspaces: new Set(['w']),
      deleteFiles: new Set(['w', 'other']),
      drops: new Set(['c1']),
    }
    expect(selectionOf(choices)).toEqual({
      bookmarks: ['a'],
      abandonBookmarkCommits: ['a'],
      deletedBookmarks: [],
      deleteRemote: [],
      workspaces: ['w'],
      deleteWorkspaceFiles: ['w'],
      divergent: ['c1'],
      undescribed: [],
    })
    expect(countOf(choices)).toBe(3)
  })
})

describe('load', () => {
  const empty: CleanupSnapshot = {
    bookmarks: [],
    deletedBookmarks: [],
    workspaces: [],
    divergent: [],
    undescribed: [],
    undescribedTruncated: false,
  }

  test('keeps the snapshot, and choices for items that are gone are dropped', () => {
    const state = run(
      { type: 'bookmark', name: 'a', selected: true },
      { type: 'load', snapshot: empty },
    )
    expect(state.snapshot).toBe(empty)
    expect(countOf(state.choices)).toBe(0)
  })
})
