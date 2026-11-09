import ignore from 'ignore'
import { describe, expect, test } from 'vitest'
import { appendIgnoreLine, ignoreLine } from '../../src/util/gitignore'

describe('ignoreLine', () => {
  test('anchors the path to the root', () => {
    expect(ignoreLine('build/out.log')).toBe('/build/out.log')
    expect(ignoreLine('#notes')).toBe('/#notes')
    expect(ignoreLine('!keep')).toBe('/!keep')
  })

  test('escapes glob characters and trailing spaces', () => {
    expect(ignoreLine('a*b?[c].txt')).toBe('/a\\*b\\?\\[c\\].txt')
    expect(ignoreLine('name  ')).toBe('/name\\ \\ ')
    expect(ignoreLine('in side')).toBe('/in side')
  })

  test.each(['plain.txt', 'dir/a*b.txt', 'q?.md', '[x].log', '#notes', '!keep', 'name '])(
    'matches %j and nothing like it',
    (path) => {
      const rules = ignore().add(ignoreLine(path))
      expect(rules.ignores(path)).toBe(true)
      expect(rules.ignores(`other/${path}`)).toBe(false)
      expect(rules.ignores(`${path}x`)).toBe(false)
    },
  )
})

describe('appendIgnoreLine', () => {
  test('starts an empty file', () => {
    expect(appendIgnoreLine('', 'secret.env')).toBe('/secret.env\n')
  })

  test('adds a newline before the line when the file lacks one', () => {
    expect(appendIgnoreLine('node_modules', 'secret.env')).toBe('node_modules\n/secret.env\n')
    expect(appendIgnoreLine('node_modules\n', 'secret.env')).toBe('node_modules\n/secret.env\n')
  })

  test('leaves the file alone when the line is there', () => {
    const content = 'dist\r\n/secret.env\r\n'
    expect(appendIgnoreLine(content, 'secret.env')).toBe(content)
  })
})
