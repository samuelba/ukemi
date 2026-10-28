import { describe, expect, test } from 'vitest'
import { applyConflicts, parseConflicts, sideName } from '../../src/conflict/markers'

function marked(char: string, label = ''): string {
  return `${char.repeat(7)}${label ? ` ${label}` : ''}`
}

function file(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`
}

const diffFrom = marked('%', 'diff from: vpxusssl 38d49363 "merge base"')
const diffTo = `${'\\'.repeat(7)}        to: rtsqusxu 2768b0b9 "commit A"`

function diffConflict(): string {
  return file([
    marked('<', 'conflict 1 of 1'),
    diffFrom,
    diffTo,
    ' apple',
    '-grape',
    '+grapefruit',
    ' orange',
    marked('+', 'ysrnknol 7a20f389 "commit B"'),
    'APPLE',
    'GRAPE',
    'ORANGE',
    marked('>', 'conflict 1 of 1 ends'),
  ])
}

describe('parseConflicts', () => {
  test('reads the two sides of a diff-style conflict', () => {
    const blocks = parseConflicts(`keep\n${diffConflict()}tail\n`)

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.sides.map((side) => side.label)).toEqual([
      'rtsqusxu 2768b0b9 "commit A"',
      'ysrnknol 7a20f389 "commit B"',
    ])
    expect(blocks[0]?.sides.map((side) => side.text)).toEqual([
      'apple\ngrapefruit\norange\n',
      'APPLE\nGRAPE\nORANGE\n',
    ])
  })

  test('reads snapshot sides and skips the base', () => {
    const blocks = parseConflicts(
      file([
        marked('<', 'conflict 1 of 1'),
        marked('+', 'rtsqusxu 2768b0b9 "commit A"'),
        'apple',
        'grapefruit',
        'orange',
        marked('-', 'vpxusssl 38d49363 "merge base"'),
        'apple',
        'grape',
        'orange',
        marked('+', 'ysrnknol 7a20f389 "commit B"'),
        'APPLE',
        'GRAPE',
        'ORANGE',
        marked('>', 'conflict 1 of 1 ends'),
      ]),
    )

    expect(blocks[0]?.sides).toEqual([
      { label: 'rtsqusxu 2768b0b9 "commit A"', text: 'apple\ngrapefruit\norange\n' },
      { label: 'ysrnknol 7a20f389 "commit B"', text: 'APPLE\nGRAPE\nORANGE\n' },
    ])
  })

  test('reads a git conflict and skips the base', () => {
    const blocks = parseConflicts(
      file([
        marked('<', 'rtsqusxu 2768b0b9 "commit A"'),
        'apple',
        'grapefruit',
        'orange',
        marked('|', 'vpxusssl 38d49363 "merge base"'),
        'apple',
        'grape',
        'orange',
        marked('='),
        'APPLE',
        'GRAPE',
        'ORANGE',
        marked('>', 'ysrnknol 7a20f389 "commit B"'),
      ]),
    )

    expect(blocks[0]?.sides).toEqual([
      { label: 'rtsqusxu 2768b0b9 "commit A"', text: 'apple\ngrapefruit\norange\n' },
      { label: 'ysrnknol 7a20f389 "commit B"', text: 'APPLE\nGRAPE\nORANGE\n' },
    ])
  })

  test('reads three diff-style sides in file order', () => {
    const blocks = parseConflicts(
      file([
        marked('<', 'conflict 1 of 1'),
        marked('%', 'diff from: base'),
        `${'\\'.repeat(7)}        to: side one`,
        '-old',
        '+one',
        marked('+', 'side two'),
        'two',
        marked('%', 'diff from: base'),
        `${'\\'.repeat(7)}        to: side three`,
        '-old',
        '+three',
        marked('>', 'conflict 1 of 1 ends'),
      ]),
    )

    expect(blocks[0]?.sides.map((side) => side.text)).toEqual(['one\n', 'two\n', 'three\n'])
    expect(sideName(3, 2)).toBe('side 3')
  })

  test('drops the display newline when a side has none', () => {
    const blocks = parseConflicts(
      [
        marked('<', 'conflict 1 of 1'),
        marked('+', `left ${'(no terminating newline)'}`),
        'abc',
        marked('+', 'right'),
        'xyz',
        '',
        marked('>', 'conflict 1 of 1 ends'),
      ].join('\n'),
    )

    expect(blocks[0]?.sides).toEqual([
      { label: 'left', text: 'abc' },
      { label: 'right', text: 'xyz\n' },
    ])
  })
})

describe('applyConflicts', () => {
  test('replaces a diff conflict with one side and keeps the surrounding text', () => {
    const text = `keep\n${diffConflict()}tail\n`

    expect(applyConflicts(text, { conflictIndex: 0, sideIndex: 0 })).toBe(
      'keep\napple\ngrapefruit\norange\ntail\n',
    )
    expect(applyConflicts(text, { conflictIndex: 0, sideIndex: 1 })).toBe(
      'keep\nAPPLE\nGRAPE\nORANGE\ntail\n',
    )
  })

  test('replaces a git conflict and leaves the base out', () => {
    const text = file([
      'before',
      marked('<', 'commit A'),
      'ours',
      marked('|', 'base'),
      'base',
      marked('='),
      'theirs',
      marked('>', 'commit B'),
      'after',
    ])

    expect(applyConflicts(text, { conflictIndex: 0, sideIndex: 0 })).toBe('before\nours\nafter\n')
    expect(applyConflicts(text, { sideIndex: 1 })).toBe('before\ntheirs\nafter\n')
  })

  test('accepts only the second conflict', () => {
    const text = file([
      'alpha',
      marked('<', 'conflict 1 of 2'),
      marked('+', 'left-a'),
      'A',
      marked('+', 'right-a'),
      'B',
      marked('>', 'conflict 1 of 2 ends'),
      'middle',
      marked('<', 'conflict 2 of 2'),
      marked('+', 'left-b'),
      'C',
      marked('+', 'right-b'),
      'D',
      marked('>', 'conflict 2 of 2 ends'),
      'omega',
    ])
    const first = parseConflicts(text)[0]
    const firstText = first ? text.slice(first.start, first.end) : ''

    const result = applyConflicts(text, { conflictIndex: 1, sideIndex: 0 })

    expect(result).toContain(firstText)
    expect(result).toBe(
      file([
        'alpha',
        marked('<', 'conflict 1 of 2'),
        marked('+', 'left-a'),
        'A',
        marked('+', 'right-a'),
        'B',
        marked('>', 'conflict 1 of 2 ends'),
        'middle',
        'C',
        'omega',
      ]),
    )
  })

  test('accepts one side of every conflict', () => {
    const text = file([
      'alpha',
      marked('<', 'conflict 1 of 2'),
      marked('+', 'left-a'),
      'A',
      marked('+', 'right-a'),
      'B',
      marked('>', 'conflict 1 of 2 ends'),
      'middle',
      marked('<', 'conflict 2 of 2'),
      marked('+', 'left-b'),
      'C',
      marked('+', 'right-b'),
      'D',
      marked('>', 'conflict 2 of 2 ends'),
      'omega',
    ])

    expect(applyConflicts(text, { sideIndex: 1 })).toBe(
      file(['alpha', 'B', 'middle', 'D', 'omega']),
    )
  })

  test('accepts the third side of a diff conflict', () => {
    const text = file([
      marked('<', 'conflict 1 of 1'),
      marked('%', 'diff from: base'),
      `${'\\'.repeat(7)}        to: side one`,
      '-old',
      '+one',
      marked('+', 'side two'),
      'two',
      marked('%', 'diff from: base'),
      `${'\\'.repeat(7)}        to: side three`,
      '-old',
      '+three',
      marked('>', 'conflict 1 of 1 ends'),
    ])

    expect(applyConflicts(text, { conflictIndex: 0, sideIndex: 2 })).toBe('three\n')
  })

  test('leaves a file with no markers unchanged', () => {
    expect(parseConflicts('hello\n')).toEqual([])
    expect(applyConflicts('hello\n', { sideIndex: 0 })).toBe('hello\n')
    expect(() => applyConflicts('hello\n', { conflictIndex: 0, sideIndex: 0 })).toThrow(
      /not in this file/,
    )
  })
})

describe('conflict line roles', () => {
  test('tags diff-style markers, removed, added, and snapshot lines with their side', () => {
    const blocks = parseConflicts(`keep\n${diffConflict()}`)

    expect(blocks[0]?.lines.map(({ line, kind, sideIndex }) => [line, kind, sideIndex])).toEqual([
      [1, 'marker', null],
      [2, 'marker', 0],
      [3, 'marker', 0],
      [4, 'side', 0],
      [5, 'removed', 0],
      [6, 'added', 0],
      [7, 'side', 0],
      [8, 'marker', 1],
      [9, 'side', 1],
      [10, 'side', 1],
      [11, 'side', 1],
      [12, 'marker', null],
    ])
  })

  test('tags git markers and the base section', () => {
    const blocks = parseConflicts(
      file([
        marked('<', 'A'),
        'ours',
        marked('|', 'base'),
        'base',
        marked('='),
        'theirs',
        marked('>', 'B'),
      ]),
    )

    expect(blocks[0]?.lines.map(({ kind, sideIndex }) => [kind, sideIndex])).toEqual([
      ['marker', 0],
      ['side', 0],
      ['marker', null],
      ['base', null],
      ['marker', 1],
      ['side', 1],
      ['marker', 1],
    ])
  })
})

describe('sideName', () => {
  test('uses current and incoming for two sides', () => {
    expect(sideName(2, 0)).toBe('current')
    expect(sideName(2, 1)).toBe('incoming')
  })
})
