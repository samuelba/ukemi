import { describe, expect, test } from 'vitest'
import type { ParsedBookmark } from '../../src/jj/parse'
import { bookmarkGroups, bookmarkRows, isBookmarkTreeElement } from '../../src/repo/bookmarkItems'

function row(overrides: Partial<ParsedBookmark> = {}): ParsedBookmark {
  return {
    name: 'feature',
    remote: null,
    present: true,
    conflict: false,
    tracked: false,
    commitId: 'abc',
    description: 'fix the gate',
    inTrunk: false,
    ...overrides,
  }
}

const rows = [
  row(),
  row({ name: 'zeta', description: 'last' }),
  row({ name: 'alpha', description: 'first\nmore', conflict: true }),
  row({ name: 'gone', present: false, description: 'old' }),
  row({ name: 'main', description: 'trunk line' }),
  row({ name: 'drift', commitId: 'left', description: 'local drift' }),
  row({
    name: 'feature',
    remote: 'origin',
    tracked: true,
    commitId: 'abc',
    description: 'fix the gate',
  }),
  row({
    name: 'drift',
    remote: 'origin',
    tracked: true,
    commitId: 'right',
    description: 'remote drift',
  }),
  row({
    name: 'only-remote',
    remote: 'upstream',
    tracked: false,
    commitId: 'up',
    description: 'from upstream',
  }),
  row({ name: 'gitty', remote: 'git', commitId: 'abc', description: 'git only' }),
  row({
    name: 'main',
    remote: 'origin',
    tracked: true,
    commitId: 'trunk',
    description: 'trunk line',
  }),
]

describe('bookmarkGroups', () => {
  test('puts local first, then remotes by name, and drops git', () => {
    expect(bookmarkGroups(rows, '/repo').map((group) => group.label)).toEqual([
      'Local',
      'origin',
      'upstream',
    ])
  })

  test('omits an empty local group', () => {
    expect(
      bookmarkGroups([row({ remote: 'origin' })], '/repo').map((group) => group.label),
    ).toEqual(['origin'])
  })

  test('returns nothing when every row is the git remote', () => {
    expect(bookmarkGroups([row({ remote: 'git' })], '/repo')).toEqual([])
  })
})

describe('bookmarkRows', () => {
  const groups = bookmarkGroups(rows, '/repo')
  const local = groups[0]
  const origin = groups[1]
  if (!local || !origin) {
    throw new Error('expected local and origin groups')
  }
  const localRows = bookmarkRows(rows, local, 'main')
  const originRows = bookmarkRows(rows, origin, 'main')

  test('sorts local names and marks sync, conflict, deletion, and trunk', () => {
    expect(localRows.map((item) => item.label)).toEqual([
      'alpha',
      'drift',
      'feature',
      '(deleted) gone',
      'main',
      'zeta',
    ])
    expect(localRows.find((item) => item.name === 'feature')).toMatchObject({
      description: 'fix the gate',
      contextValue: 'bookmark+local+present',
      commitId: 'abc',
    })
    expect(localRows.find((item) => item.name === 'drift')).toMatchObject({
      description: 'local drift *',
      contextValue: 'bookmark+local+unsynced+present',
    })
    expect(localRows.find((item) => item.name === 'alpha')).toMatchObject({
      description: 'first * ??',
      contextValue: 'bookmark+local+unsynced+conflict+present',
    })
    expect(localRows.find((item) => item.name === 'gone')).toMatchObject({
      label: '(deleted) gone',
      description: 'old',
      contextValue: 'bookmark+local+deleted',
      tooltipLines: ['(deleted) gone', 'old', 'abc', 'deleted'],
    })
    expect(localRows.find((item) => item.name === 'main')).toMatchObject({
      description: 'trunk line *',
      contextValue: 'bookmark+local+unsynced+trunk+present',
    })
    expect(localRows.find((item) => item.name === 'zeta')?.description).toBe('last *')
  })

  test('labels remote rows as name@remote and tracks trunk', () => {
    expect(originRows.map((item) => item.label)).toEqual([
      'drift@origin',
      'feature@origin',
      'main@origin',
    ])
    expect(originRows.find((item) => item.name === 'feature')).toMatchObject({
      description: 'fix the gate',
      contextValue: 'bookmark+remote+present+tracked',
      remote: 'origin',
    })
    expect(originRows.find((item) => item.name === 'drift')?.description).toBe('remote drift')
    expect(originRows.find((item) => item.name === 'main')?.contextValue).toBe(
      'bookmark+remote+trunk+present+tracked',
    )
  })

  test('leaves an untracked remote without the tracked flag', () => {
    const upstream = groups.find((group) => group.remote === 'upstream')
    if (!upstream) {
      throw new Error('expected upstream group')
    }
    expect(bookmarkRows(rows, upstream, 'main')).toEqual([
      expect.objectContaining({
        label: 'only-remote@upstream',
        description: 'from upstream',
        contextValue: 'bookmark+remote+present',
      }),
    ])
  })

  test('does not list git rows under local', () => {
    expect(localRows.map((item) => item.name)).not.toContain('gitty')
  })

  test('treats local bookmarks as synced when the repo has no remote', () => {
    const group = bookmarkGroups([row()], '/repo')[0]
    expect(group && bookmarkRows([row()], group, null, false)[0]).toMatchObject({
      description: 'fix the gate',
      contextValue: 'bookmark+local+present',
    })
  })

  test('says that push deletes each tracked remote of a deleted local bookmark', () => {
    const deleted = row({ name: 'old', present: false, description: 'gone', commitId: null })
    const origin = row({
      name: 'old',
      remote: 'origin',
      tracked: true,
      commitId: 'abc',
      description: 'gone',
    })
    const upstream = row({
      name: 'old',
      remote: 'upstream',
      tracked: true,
      commitId: 'abc',
      description: 'gone',
    })
    const group = bookmarkGroups([deleted, origin, upstream], '/repo')[0]
    const item = group ? bookmarkRows([deleted, origin, upstream], group, null)[0] : undefined
    expect(item?.tooltipLines).toEqual([
      '(deleted) old',
      'gone',
      'No commit',
      'deleted',
      'Push deletes old@origin, old@upstream',
    ])
  })
})

describe('isBookmarkTreeElement', () => {
  test('accepts a bookmark row and rejects groups and plain objects', () => {
    const group = bookmarkGroups([row()], '/repo')[0]
    const item = group ? bookmarkRows([row()], group, null)[0] : undefined
    expect(isBookmarkTreeElement(item)).toBe(true)
    expect(isBookmarkTreeElement(group)).toBe(false)
    expect(isBookmarkTreeElement({ kind: 'bookmark', name: 1 })).toBe(false)
    expect(isBookmarkTreeElement(null)).toBe(false)
  })
})
