import { describe, expect, test } from 'vitest'
import { diffHunks, patchHunks } from '../../webview/src/desktop/diffModel'

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
