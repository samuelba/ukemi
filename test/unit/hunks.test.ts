import { describe, expect, test } from 'vitest'
import { buildContent, computeSegments } from '../../src/split/hunks'

const left = 'a\nb\nc\nd\ne\n'
const right = 'a\nB\nc\nd\nE\nf\n'

describe('computeSegments', () => {
  test('groups adjacent removals and additions into one change', () => {
    const segments = computeSegments(left, right)

    expect(segments.filter((s) => s.kind === 'change')).toEqual([
      { kind: 'change', id: 0, removed: 'b\n', added: 'B\n' },
      { kind: 'change', id: 1, removed: 'e\n', added: 'E\nf\n' },
    ])
  })

  test('returns no changes for identical content', () => {
    expect(computeSegments(left, left)).toEqual([{ kind: 'same', text: left }])
  })
})

describe('buildContent', () => {
  test('reproduces the left side when nothing is selected', () => {
    expect(buildContent(computeSegments(left, right), new Set())).toBe(left)
  })

  test('reproduces the right side when everything is selected', () => {
    expect(buildContent(computeSegments(left, right), new Set([0, 1]))).toBe(right)
  })

  test('applies only the selected hunk', () => {
    expect(buildContent(computeSegments(left, right), new Set([1]))).toBe('a\nb\nc\nd\nE\nf\n')
  })

  test('handles added files', () => {
    const segments = computeSegments('', 'new\n')
    expect(buildContent(segments, new Set([0]))).toBe('new\n')
    expect(buildContent(segments, new Set())).toBe('')
  })
})
