import { describe, expect, test } from 'vitest'
import {
  parseSearch,
  searchCommits,
  stepMatch,
  type SearchableCommit,
} from '../../webview/src/graph/matchCommit'

function commit(id: string, overrides: Partial<SearchableCommit> = {}): SearchableCommit {
  return {
    commitId: `${id}000`,
    changeId: `${id}zzz`,
    description: '',
    author: { name: 'Ada Lovelace', email: 'ada@example.com' },
    localBookmarks: [],
    tags: [],
    ...overrides,
  }
}

const COMMITS = [
  commit('a', { description: 'feat: add the cart total\n\nLonger body about Totals' }),
  commit('b', {
    description: 'fix: login',
    author: { name: 'Grace Hopper', email: 'grace@example.com' },
    localBookmarks: [{ name: 'fix/login' }],
  }),
  commit('c', { description: 'docs: setup', tags: ['v1.0'] }),
]

describe('graph search', () => {
  test('an empty search matches nothing and dims nothing', () => {
    expect(parseSearch('   ')).toBeNull()
    expect(searchCommits(COMMITS, '')).toBeNull()
  })

  test('matches descriptions case-insensitively, with every word required', () => {
    expect(searchCommits(COMMITS, 'TOTALS')).toEqual(['a000'])
    expect(searchCommits(COMMITS, 'fix login')).toEqual(['b000'])
    expect(searchCommits(COMMITS, 'fix cart')).toEqual([])
  })

  test('matches bookmarks, tags, authors and id prefixes', () => {
    expect(searchCommits(COMMITS, 'fix/login')).toEqual(['b000'])
    expect(searchCommits(COMMITS, 'v1.0')).toEqual(['c000'])
    expect(searchCommits(COMMITS, 'hopper')).toEqual(['b000'])
    expect(searchCommits(COMMITS, 'czz')).toEqual(['c000'])
  })

  test('author: looks at the author only', () => {
    expect(searchCommits(COMMITS, 'author:grace')).toEqual(['b000'])
    expect(searchCommits(COMMITS, 'author:ada docs')).toEqual(['c000'])
  })

  test('steps through the matches and wraps around', () => {
    const matches = ['a', 'b', 'c']
    expect(stepMatch(matches, null, 1)).toBe('a')
    expect(stepMatch(matches, null, -1)).toBe('c')
    expect(stepMatch(matches, 'c', 1)).toBe('a')
    expect(stepMatch(matches, 'a', -1)).toBe('c')
    expect(stepMatch(matches, 'x', 1)).toBe('a')
    expect(stepMatch([], 'a', 1)).toBeNull()
  })
})
