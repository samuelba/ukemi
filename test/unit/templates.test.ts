import { describe, expect, test } from 'vitest'
import { jjString, jsonObject, jsonArray } from '../../src/jj/templates'
import { quoteRevsetString, rootFileset, graphRevset } from '../../src/jj/revsets'

describe('jjString', () => {
  test('wraps plain text in double quotes', () => {
    expect(jjString('abc')).toBe('"abc"')
  })

  test('escapes quotes, backslashes and newlines', () => {
    expect(jjString('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"')
  })
})

describe('jsonObject', () => {
  test('concatenates key literals and value expressions', () => {
    const template = jsonObject({ a: 'json(x)', b: 'json(y)' })
    expect(template).toBe('"{\\"a\\":" ++ json(x) ++ ",\\"b\\":" ++ json(y) ++ "}"')
  })
})

describe('jsonArray', () => {
  test('joins mapped json values with commas', () => {
    expect(jsonArray('xs', 'x', 'json(x)')).toBe('"[" ++ xs.map(|x| json(x)).join(",") ++ "]"')
  })
})

describe('quoteRevsetString', () => {
  test('escapes quotes in revset string literals', () => {
    expect(quoteRevsetString('my "branch"')).toBe('"my \\"branch\\""')
  })
})

describe('rootFileset', () => {
  test('builds a root-file pattern', () => {
    expect(rootFileset('src/a b.ts')).toBe('root-file:"src/a b.ts"')
  })
})

describe('graphRevset', () => {
  test('limits recent history by committer date', () => {
    const revset = graphRevset('recent', '7d')
    expect(revset).toContain('committer_date(after:"7 days ago")')
    expect(revset).toContain('present(@)')
    expect(revset).toContain('~ root()')
  })

  test('drops the date filter for full history', () => {
    expect(graphRevset('recent', 'all')).not.toContain('committer_date')
  })

  test('restricts to own changes for the mine filter', () => {
    expect(graphRevset('mine', '30d')).toContain('mine()')
  })

  test('uses the reachable stack of @ for the stack filter', () => {
    expect(graphRevset('stack', '7d')).toContain('reachable(@, mutable())')
  })
})
