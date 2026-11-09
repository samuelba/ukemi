import { describe, expect, test } from 'vitest'
import { readSettings } from '../../src/app/settings'
import {
  findSavedRevset,
  savedRevsetByLabel,
  savedRevsetList,
  withSavedRevset,
} from '../../shared/savedRevsets'
import {
  CUSTOM_FILTER,
  filterValue,
  savedFilterValue,
  savedFromValue,
} from '../../webview/src/graph/filterValue'

function settingsWith(values: Record<string, unknown>) {
  return readSettings({
    get: <T>(key: string, fallback: T) => (key in values ? (values[key] as T) : fallback),
  })
}

describe('savedRevsetList', () => {
  test('keeps the order of the settings map', () => {
    expect(savedRevsetList({ Release: '::release', Mine: 'mine()' })).toEqual([
      { label: 'Release', revset: '::release' },
      { label: 'Mine', revset: 'mine()' },
    ])
  })

  test('trims labels and revsets and drops empty or non-string entries', () => {
    expect(savedRevsetList({ ' A ': ' a() ', B: '  ', ' ': 'c()', D: 4, E: null })).toEqual([
      { label: 'A', revset: 'a()' },
    ])
  })

  test('keeps the first of two labels that only differ in outer whitespace', () => {
    expect(savedRevsetList({ ' A ': 'a()', A: 'b()' })).toEqual([{ label: 'A', revset: 'a()' }])
  })

  test('reads nothing from a value that is not a map', () => {
    expect(savedRevsetList(undefined)).toEqual([])
    expect(savedRevsetList(['mine()'])).toEqual([])
    expect(savedRevsetList('mine()')).toEqual([])
  })
})

describe('lookups', () => {
  const saved = savedRevsetList({ Release: '::release', Mine: 'mine()' })

  test('finds a saved revset by its text, ignoring outer whitespace', () => {
    expect(findSavedRevset(saved, ' mine() ')?.label).toBe('Mine')
    expect(findSavedRevset(saved, 'mine() & trunk()..')).toBeUndefined()
  })

  test('finds a saved revset by its label', () => {
    expect(savedRevsetByLabel(saved, 'Release')?.revset).toBe('::release')
    expect(savedRevsetByLabel(saved, '')).toBeUndefined()
    expect(savedRevsetByLabel(saved, 'release')).toBeUndefined()
  })
})

describe('withSavedRevset', () => {
  test('adds a new entry at the end and leaves the old map alone', () => {
    const current = { Release: '::release' }
    expect(withSavedRevset(current, 'Mine', 'mine()')).toEqual({
      Release: '::release',
      Mine: 'mine()',
    })
    expect(current).toEqual({ Release: '::release' })
  })

  test('replaces an entry in its place', () => {
    const next = withSavedRevset({ A: 'a()', B: 'b()' }, 'A', 'x()')
    expect(Object.entries(next)).toEqual([
      ['A', 'x()'],
      ['B', 'b()'],
    ])
  })

  test('replaces a hand-written key with spaces instead of adding a second one', () => {
    const next = withSavedRevset({ ' A ': 'a()', B: 'b()', 'A ': 'c()' }, 'A', 'x()')
    expect(Object.entries(next)).toEqual([
      ['A', 'x()'],
      ['B', 'b()'],
    ])
  })

  test('starts from an empty map when the setting holds something else', () => {
    expect(withSavedRevset('oops', 'A', 'a()')).toEqual({ A: 'a()' })
  })
})

describe('readSettings', () => {
  test('reads the saved revsets and the default one', () => {
    const config = settingsWith({
      savedRevsets: { Mine: 'mine()' },
      defaultRevset: ' Mine ',
      defaultFilter: 'jjLog',
    })
    expect(config.savedRevsets).toEqual([{ label: 'Mine', revset: 'mine()' }])
    expect(config.defaultRevset).toBe('Mine')
    expect(config.defaultFilter).toBe('jjLog')
  })

  test('has no saved revsets and no default by default', () => {
    const config = settingsWith({})
    expect(config.savedRevsets).toEqual([])
    expect(config.defaultRevset).toBe('')
  })
})

describe('filterValue', () => {
  const saved = savedRevsetList({ Release: '::release', Mine: 'mine()' })

  test('shows the filter when no revset is set', () => {
    expect(filterValue({ filter: 'stack', revset: null }, saved)).toBe('stack')
  })

  test('shows the saved revset the graph shows', () => {
    expect(filterValue({ filter: 'recent', revset: 'mine()' }, saved)).toBe(savedFilterValue(1))
  })

  test('shows Revset… for a revset that is not saved', () => {
    expect(filterValue({ filter: 'recent', revset: 'all()' }, saved)).toBe(CUSTOM_FILTER)
  })
})

describe('savedFromValue', () => {
  const saved = savedRevsetList({ Release: '::release', Mine: 'mine()' })

  test('finds the saved revset of an option value', () => {
    expect(savedFromValue(savedFilterValue(1), saved)?.revset).toBe('mine()')
  })

  test('finds nothing for filters, Revset… or an index past the list', () => {
    expect(savedFromValue('mine', saved)).toBeUndefined()
    expect(savedFromValue(CUSTOM_FILTER, saved)).toBeUndefined()
    expect(savedFromValue(savedFilterValue(5), saved)).toBeUndefined()
  })
})
