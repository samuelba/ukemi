import { describe, expect, test } from 'vitest'
import type { SettingField, ShortcutField } from '../../shared/desktopProtocol'
import {
  matchesQuery,
  ownShortcuts,
  readText,
  repositoryField,
  shortcutClashes,
  TEXT_FORMATS,
  withShortcut,
} from '../../webview/src/desktop/settingsValues'

function field(overrides: Partial<SettingField>): SettingField {
  return {
    key: 'k',
    group: 'G',
    title: 'Title',
    description: 'Some description',
    type: 'string',
    default: '',
    value: undefined,
    isRepositoryScoped: false,
    overriddenIn: [],
    ...overrides,
  }
}

describe('text formats', () => {
  test('lists and maps round-trip through their text', () => {
    expect(TEXT_FORMATS.list.toText(['a', 'b'])).toBe('a\nb')
    expect(TEXT_FORMATS.list.fromText(' a \n\n b ')).toEqual(['a', 'b'])
    expect(TEXT_FORMATS.map.toText({ host: 'x' })).toBe('host = x')
    expect(TEXT_FORMATS.map.fromText('host = x\nother=y')).toEqual({ host: 'x', other: 'y' })
  })
})

describe('readText', () => {
  test('unchanged text saves nothing', () => {
    expect(readText(field({ value: 'abc' }), 'string', 'abc')).toEqual({ kind: 'unchanged' })
  })

  test('an empty number or string goes back to the default, an empty list does not', () => {
    expect(readText(field({ value: 'abc' }), 'string', '  ')).toEqual({ kind: 'reset' })
    expect(readText(field({ type: 'number', value: 3 }), 'number', '')).toEqual({ kind: 'reset' })
    expect(readText(field({ type: 'list', value: ['a'] }), 'list', '')).toEqual({
      kind: 'value',
      value: [],
    })
  })

  test('a map line without "=" is a problem', () => {
    const outcome = readText(field({ type: 'map', default: {} }), 'map', 'nohost')
    expect(outcome.kind).toBe('problem')
  })

  test('checks the pattern and the number range', () => {
    const pattern = field({ pattern: '^[a-z]+$', patternMessage: 'Lowercase only.' })
    expect(readText(pattern, 'string', 'ABC')).toEqual({
      kind: 'problem',
      problem: 'Lowercase only.',
    })
    const number = field({ type: 'number', default: 4, minimum: 1, maximum: 12 })
    expect(readText(number, 'number', '20')).toEqual({
      kind: 'problem',
      problem: 'Enter a number from 1 to 12.',
    })
    expect(readText(number, 'number', 'x').kind).toBe('problem')
    expect(readText(number, 'number', '6')).toEqual({ kind: 'value', value: 6 })
  })
})

describe('repositoryField and matchesQuery', () => {
  test('a repository field falls back to the global value', () => {
    const shown = repositoryField(field({ value: 'global', default: 'd' }), {
      id: '/r',
      label: 'r',
      values: {},
    })
    expect(shown.value).toBeUndefined()
    expect(shown.default).toBe('global')
  })

  test('searches title, key, description and shortcut titles', () => {
    const f = field({
      shortcuts: [{ id: 'a', menu: 'File', title: 'Open Repository', default: '' }],
    })
    expect(matchesQuery(f, '')).toBe(true)
    expect(matchesQuery(f, 'DESCRIPTION')).toBe(true)
    expect(matchesQuery(f, 'open repo')).toBe(true)
    expect(matchesQuery(f, 'nothing')).toBe(false)
  })
})

describe('shortcuts', () => {
  const actions: ShortcutField[] = [
    { id: 'a', menu: 'File', title: 'A', default: 'CmdOrCtrl+O' },
    { id: 'b', menu: 'File', title: 'B', default: 'CmdOrCtrl+P' },
    { id: 'c', menu: 'View', title: 'C', default: '' },
  ]

  test('finds the commands that share keys, own keys included', () => {
    const clashes = shortcutClashes(actions, { b: 'CmdOrCtrl+O' }, 'linux')
    expect(clashes.get('a')).toEqual(['B'])
    expect(clashes.get('b')).toEqual(['A'])
    expect(clashes.has('c')).toBe(false)
  })

  test('stores only keys that differ from the default', () => {
    expect(withShortcut({}, actions[0]!, 'CmdOrCtrl+K')).toEqual({ a: 'CmdOrCtrl+K' })
    expect(withShortcut({ a: 'CmdOrCtrl+K' }, actions[0]!, 'CmdOrCtrl+O')).toEqual({})
    expect(withShortcut({ a: 'CmdOrCtrl+K' }, actions[0]!, null)).toEqual({})
    expect(withShortcut({}, actions[0]!, '')).toEqual({ a: '' })
  })

  test('reads only string values as own keys', () => {
    expect(ownShortcuts({ a: 'X', b: 3 })).toEqual({ a: 'X' })
    expect(ownShortcuts(['a'])).toEqual({})
  })
})
