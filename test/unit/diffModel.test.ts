import { describe, expect, test } from 'vitest'
import {
  dataUrlBytes,
  diffHunks,
  formatBytes,
  isLargeDiff,
  LARGE_DIFF_LINES,
  patchHunks,
  segments,
  splitRows,
  svgDataUrl,
} from '../../webview/src/desktop/diffModel'

const lines = (...items: string[]) => `${items.join('\n')}\n`

describe('diffHunks', () => {
  test('keeps three lines of context around a change, with numbers on both sides', () => {
    const left = lines('1', '2', '3', '4', '5', '6', '7', '8', '9')
    const right = lines('1', '2', '3', '4', 'five', '6', '7', '8', '9')
    const [hunk] = diffHunks(left, right)
    expect(hunk?.rows.map((r) => [r.kind, r.oldLine, r.newLine])).toEqual([
      ['same', 2, 2],
      ['same', 3, 3],
      ['same', 4, 4],
      ['removed', 5, null],
      ['added', null, 5],
      ['same', 6, 6],
      ['same', 7, 7],
      ['same', 8, 8],
    ])
    expect(hunk?.header).toBe('@@ -2,7 +2,7 @@')
  })

  test('marks the changed words of a removed line paired with an added one', () => {
    const [hunk] = diffHunks(lines('let total = 1'), lines('let sum = 1'))
    const removed = hunk?.rows.find((r) => r.kind === 'removed')
    const added = hunk?.rows.find((r) => r.kind === 'added')
    expect(removed?.parts?.filter((p) => p.changed).map((p) => p.text)).toEqual(['total'])
    expect(added?.parts?.filter((p) => p.changed).map((p) => p.text)).toEqual(['sum'])
  })

  test('shows a new file as added lines only', () => {
    const [hunk] = diffHunks(null, lines('a', 'b'))
    expect(hunk?.rows.map((r) => r.kind)).toEqual(['added', 'added'])
    expect(hunk?.rows.map((r) => r.text)).toEqual(['a', 'b'])
  })

  test('shows a removed file as removed lines only', () => {
    const [hunk] = diffHunks(lines('a'), null)
    expect(hunk?.rows.map((r) => [r.kind, r.oldLine])).toEqual([['removed', 1]])
  })

  test('has no hunks for identical text', () => {
    expect(diffHunks(lines('a'), lines('a'))).toEqual([])
  })

  test('skips word marks on long lines', () => {
    const long = 'x'.repeat(2_000)
    const [hunk] = diffHunks(lines(long), lines(`${long}y`))
    expect(hunk?.rows.every((r) => r.parts === undefined)).toBe(true)
  })
})

describe('diffHunks ignoring whitespace', () => {
  const ignore = { ignoreWhitespace: true }

  test('has no hunks when only indentation and spacing changed', () => {
    const left = lines('if (a) {', '  call(x,  y)', '}')
    const right = lines('if (a) {', '\tcall(x, y)  ', '}')
    expect(diffHunks(left, right, ignore)).toEqual([])
    expect(diffHunks(left, right)).toHaveLength(1)
  })

  test('still shows a space removed between words', () => {
    const [hunk] = diffHunks(lines('a b'), lines('ab'), ignore)
    expect(hunk?.rows.map((r) => r.kind)).toEqual(['removed', 'added'])
  })

  test('keeps the old text of an unchanged line that was re-indented', () => {
    const [hunk] = diffHunks(lines('  keep', 'old'), lines('    keep', 'new'), ignore)
    const kept = hunk?.rows.find((r) => r.kind === 'same')
    expect([kept?.text, kept?.oldText]).toEqual(['    keep', '  keep'])
    const same = diffHunks(lines('keep', 'old'), lines('keep', 'new'), ignore)[0]?.rows[0]
    expect(same?.oldText).toBeUndefined()
  })

  test('does not mark changed spacing inside a changed line', () => {
    const marked = (options = {}) =>
      diffHunks(lines('let  x =  1'), lines('let x = 2'), options)[0]
        ?.rows.find((r) => r.kind === 'removed')
        ?.parts?.filter((p) => p.changed)
        .map((p) => p.text)
    expect(marked(ignore)).toEqual([' 1'])
    expect(marked()).toEqual(['  ', '  1'])
  })
})

describe('splitRows', () => {
  test('puts an unchanged line on both sides and pads the shorter run', () => {
    const [hunk] = diffHunks(lines('keep', 'a', 'b', 'end'), lines('keep', 'c', 'end'))
    expect(
      splitRows(hunk?.rows ?? []).map((r) => [r.left?.text ?? null, r.right?.text ?? null]),
    ).toEqual([
      ['keep', 'keep'],
      ['a', 'c'],
      ['b', null],
      ['end', 'end'],
    ])
  })

  test('pairs the rows whose words are marked against each other', () => {
    const [hunk] = diffHunks(lines('let total = 1'), lines('let sum = 1'))
    const [row] = splitRows(hunk?.rows ?? [])
    expect(row?.left?.parts?.some((p) => p.changed)).toBe(true)
    expect(row?.right?.parts?.some((p) => p.changed)).toBe(true)
  })

  test('keeps a lone added run on the right and notes on both sides', () => {
    const [hunk] = diffHunks(null, lines('a'))
    expect(splitRows(hunk?.rows ?? [])).toEqual([{ left: null, right: hunk?.rows[0] }])
    const [notes] = patchHunks('Commit description changed\n')
    const [row] = splitRows(notes?.rows ?? [])
    expect(row?.left).toBe(row?.right)
  })
})

describe('patchHunks', () => {
  test('reads the hunks of a unified patch', () => {
    const patch = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '@@ -1,2 +1,2 @@',
      ' keep',
      '-old',
      '+new',
    ].join('\n')
    const [hunk] = patchHunks(patch)
    expect(hunk?.rows.map((r) => [r.kind, r.text, r.oldLine, r.newLine])).toEqual([
      ['same', 'keep', 1, 1],
      ['removed', 'old', 2, null],
      ['added', 'new', null, 2],
    ])
  })

  test('keeps lines outside hunks as notes', () => {
    const [first] = patchHunks('Commit description changed:\n  - fix\n  + fix typo\n')
    expect(first?.rows.every((r) => r.kind === 'note')).toBe(true)
  })
})

describe('segments', () => {
  test('keeps a line whole when it has no tokens or marks', () => {
    expect(segments('plain', undefined, undefined)).toEqual([{ text: 'plain', changed: false }])
  })

  test('cuts a token where a word mark starts, keeping its class on both pieces', () => {
    const tokens = [
      { from: 0, to: 3, cls: 'tok-keyword' },
      { from: 4, to: 9, cls: 'tok-string' },
    ]
    const parts = [
      { text: 'let "a', changed: false },
      { text: 'bc"', changed: true },
    ]
    expect(segments('let "abc"', tokens, parts)).toEqual([
      { text: 'let', cls: 'tok-keyword', changed: false },
      { text: ' ', cls: undefined, changed: false },
      { text: '"a', cls: 'tok-string', changed: false },
      { text: 'bc"', cls: 'tok-string', changed: true },
    ])
  })
})

describe('isLargeDiff', () => {
  const many = (count: number) => 'x\n'.repeat(count)

  test('lets ordinary files through', () => {
    expect(isLargeDiff(many(100), many(120))).toBe(false)
    expect(isLargeDiff(null, many(LARGE_DIFF_LINES))).toBe(false)
  })

  test('flags a side with too many lines or too many characters', () => {
    expect(isLargeDiff(many(LARGE_DIFF_LINES + 1), null)).toBe(true)
    expect(isLargeDiff(null, 'x'.repeat(1_000_001))).toBe(true)
  })
})

describe('image sizes', () => {
  test('counts the bytes of a base64 data URL', () => {
    for (const bytes of ['', 'a', 'ab', 'abc', 'abcd']) {
      const url = `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
      expect(dataUrlBytes(url)).toBe(bytes.length)
    }
  })

  test('counts the UTF-8 bytes of an SVG data URL', () => {
    expect(dataUrlBytes(svgDataUrl('<svg>é</svg>'))).toBe(13)
  })

  test('formats sizes in B, KB and MB', () => {
    expect([formatBytes(512), formatBytes(2048), formatBytes(3 * 1024 * 1024)]).toEqual([
      '512 B',
      '2.0 KB',
      '3.0 MB',
    ])
  })
})
