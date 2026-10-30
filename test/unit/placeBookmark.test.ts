import { describe, expect, test } from 'vitest'
import type { CommitView } from '../../shared/protocol'
import type { ParsedBookmark } from '../../src/jj/parse'
import { placeBookmark } from '../../src/repo/placeBookmark'

function commit(commitId: string, bookmarks: readonly string[]): CommitView {
  return {
    changeId: commitId,
    changePrefix: 'c',
    commitId,
    commitPrefix: commitId.slice(0, 1),
    parents: [],
    description: `${commitId} message\n`,
    author: { name: '', email: '', timestamp: '' },
    committer: { name: '', email: '', timestamp: '' },
    localBookmarks: bookmarks.map((name) => ({ name, synced: true, conflict: false })),
    remoteBookmarks: [],
    tags: [],
    workingCopies: [],
    changeOffset: null,
    isWorkingCopy: false,
    isEmpty: false,
    hasConflict: false,
    isImmutable: false,
    isDivergent: false,
    isHidden: false,
    isMine: true,
    row: { id: commitId, column: 0, width: 1, incoming: [], outgoing: [], passThrough: [] },
    isTrunk: false,
    requests: [],
  }
}

function row(name: string, commitId: string): ParsedBookmark {
  return {
    name,
    remote: null,
    present: true,
    conflict: false,
    tracked: true,
    commitId,
    description: 'old',
    inTrunk: false,
  }
}

describe('placeBookmark', () => {
  test('moves a bookmark onto the target and marks it unsynced when the repo has remotes', () => {
    const placed = placeBookmark(
      [commit('old', ['feature']), commit('new', [])],
      [row('feature', 'old')],
      'feature',
      'new',
      true,
    )

    expect(placed.commits[0]?.localBookmarks).toEqual([])
    expect(placed.commits[1]?.localBookmarks).toEqual([
      { name: 'feature', synced: false, conflict: false },
    ])
    expect(placed.bookmarks[0]).toMatchObject({
      name: 'feature',
      commitId: 'new',
      description: 'new message',
    })
    expect(placed.hasUnpushed).toBe(true)
  })

  test('leaves the bookmark synced when the repo has no remotes', () => {
    const placed = placeBookmark([commit('new', [])], [], 'feature', 'new', false)

    expect(placed.commits[0]?.localBookmarks).toEqual([
      { name: 'feature', synced: true, conflict: false },
    ])
    expect(placed.hasUnpushed).toBe(false)
  })
})
