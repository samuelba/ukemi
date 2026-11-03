import { describe, expect, test } from 'vitest'
import {
  applyCompletion,
  revsetCompletions,
  sourcesFromCommits,
  wordAt,
  type CompletionSources,
} from '../../webview/src/graph/revsetCompletion'
import { customGraphRevset } from '../../src/jj/revsets'

const SOURCES: CompletionSources = {
  bookmarks: ['main', 'feature/login', 'ok|main'],
  tags: ['v1.0'],
  authors: [{ name: 'Ada Lovelace', email: 'ada@example.com' }],
  history: ['mine() & mutable()', 'trunk()..@'],
}

describe('revset completion', () => {
  test('finds the word that ends at the cursor', () => {
    expect(wordAt('mine() & desc', 13)).toEqual({ start: 9, word: 'desc' })
    expect(wordAt('feature/lo', 10)).toEqual({ start: 0, word: 'feature/lo' })
    expect(wordAt('a | ', 4)).toEqual({ start: 4, word: '' })
  })

  test('offers the history for an empty input', () => {
    expect(revsetCompletions('', 0, SOURCES).map((c) => c.label)).toEqual(SOURCES.history)
  })

  test('completes functions by prefix, with an open parenthesis when they take arguments', () => {
    const candidates = revsetCompletions('desc', 4, SOURCES)
    expect(candidates.map((c) => c.insert)).toEqual(['description(', 'descendants('])
    expect(revsetCompletions('min', 3, SOURCES)[0]?.insert).toBe('mine()')
  })

  test('quotes bookmark names that jj would read as expressions', () => {
    const inserts = revsetCompletions('main', 4, SOURCES).map((c) => c.insert)
    expect(inserts).toContain('main')
    expect(inserts).toContain('"ok|main"')
  })

  test('completes authors by name or email into an author() filter', () => {
    const [candidate] = revsetCompletions('lovel', 5, SOURCES)
    expect(candidate?.insert).toBe('author("ada@example.com")')
  })

  test('replaces the word at the cursor and moves the cursor after it', () => {
    const [candidate] = revsetCompletions('mine() & desc', 13, SOURCES)
    expect(candidate).toBeDefined()
    if (candidate) {
      expect(applyCompletion('mine() & desc', 13, candidate)).toEqual({
        text: 'mine() & description(',
        cursor: 21,
      })
    }
  })

  test('collects bookmarks, tags and authors of the loaded changes once', () => {
    const author = { name: 'Ada', email: 'ada@example.com' }
    const sources = sourcesFromCommits(
      [
        { localBookmarks: [{ name: 'main' }], tags: ['v1'], author },
        { localBookmarks: [{ name: 'main' }, { name: 'dev' }], tags: [], author },
      ],
      [],
    )
    expect(sources.bookmarks).toEqual(['dev', 'main'])
    expect(sources.tags).toEqual(['v1'])
    expect(sources.authors).toEqual([author])
  })
})

describe('customGraphRevset', () => {
  test('keeps the working copy and trunk in view', () => {
    expect(customGraphRevset('mine()')).toBe(
      '(present(@) | working_copies() | present(trunk()) | (mine())) ~ root()',
    )
  })
})
