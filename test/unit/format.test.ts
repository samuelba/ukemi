import { describe, expect, test } from 'vitest'
import { relativeTime, splitId, splitPath, title } from '../../webview/src/shared/format'

const now = Date.parse('2026-10-22T12:00:00Z')

describe('relativeTime', () => {
  test.each([
    ['2026-10-22T11:59:40Z', 'now'],
    ['2026-10-22T11:15:00Z', '45m'],
    ['2026-10-22T07:00:00Z', '5h'],
    ['2026-10-19T12:00:00Z', '3d'],
    ['2026-03-04T12:00:00Z', 'Mar 4'],
    ['2024-03-04T12:00:00Z', 'Mar 2024'],
  ])('formats %s as %s', (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected)
  })

  test('returns an empty string for invalid dates', () => {
    expect(relativeTime('nope', now)).toBe('')
  })
})

describe('splitId', () => {
  test('separates the unique prefix and pads to the minimum length', () => {
    expect(splitId('qpvuntsmwlqt', 'qp', 4)).toEqual({ prefix: 'qp', rest: 'vu' })
  })

  test('shows at least the unique prefix', () => {
    expect(splitId('qpvuntsmwlqt', 'qpvunt', 4)).toEqual({ prefix: 'qpvunt', rest: '' })
  })
})

describe('splitPath', () => {
  test('splits directory and file name', () => {
    expect(splitPath('src/a/b.ts')).toEqual({ name: 'b.ts', dir: 'src/a' })
    expect(splitPath('README.md')).toEqual({ name: 'README.md', dir: '' })
  })
})

describe('title', () => {
  test('returns the first line', () => {
    expect(title('feat: x\n\nbody')).toBe('feat: x')
  })
})
