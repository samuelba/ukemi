import { describe, expect, test } from 'vitest'
import { bookmarkRevision, exactBookmark, revsetSymbol } from '../../src/jj/revsets'

describe('revsetSymbol', () => {
  test.each(['main', 'feature/one', 'v1.2', 'fix-bug', 'a+b', 'snake_case', 'größe'])(
    'keeps the plain symbol %s',
    (name) => {
      expect(revsetSymbol(name)).toBe(name)
    },
  )

  test.each(['ok|main', 'rel-', 'a,b', 'f@v2', 'q&r', '-x', 'a..b', 'with space', ''])(
    'quotes %j, which jj would parse as an expression',
    (name) => {
      expect(revsetSymbol(name)).toBe(`"${name}"`)
    },
  )
})

describe('bookmarkRevision', () => {
  test('names a local bookmark', () => {
    expect(bookmarkRevision('ok|main')).toBe('"ok|main"')
  })

  test('names a remote bookmark', () => {
    expect(bookmarkRevision('main', 'origin')).toBe('main@origin')
    expect(bookmarkRevision('rel-', 'up-stream')).toBe('"rel-"@up-stream')
  })
})

describe('exactBookmark', () => {
  test('always quotes the pattern', () => {
    expect(exactBookmark('main')).toBe('exact:"main"')
    expect(exactBookmark('ok|main')).toBe('exact:"ok|main"')
  })
})
