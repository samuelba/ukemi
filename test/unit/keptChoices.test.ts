import { describe, expect, test } from 'vitest'
import type { SplitFile, SplitRequest } from '../../shared/split'
import { keptChoices, type FileChoice } from '../../webview/src/split/keptChoices'

function file(path: string, text: string): SplitFile {
  return {
    path,
    sourcePath: path,
    status: 'modified',
    isBinary: false,
    segments: [{ kind: 'change', id: 0, removed: 'old\n', added: `${text}\n` }],
  }
}

function request(commitId: string, files: SplitFile[]): SplitRequest {
  return { commitId, title: 't', description: 't', files }
}

const choices: ReadonlyMap<string, FileChoice> = new Map<string, FileChoice>([
  ['a.txt', new Set([0])],
  ['b.txt', 'whole'],
])

describe('keptChoices', () => {
  test('keeps every choice when the same change comes again', () => {
    const same = request('c1', [file('a.txt', 'a'), file('b.txt', 'b')])
    expect(keptChoices(choices, same, { ...same })).toBe(choices)
  })

  test('drops the choices of a file whose hunks changed', () => {
    const before = request('c1', [file('a.txt', 'a'), file('b.txt', 'b')])
    const after = request('c1', [file('a.txt', 'edited'), file('b.txt', 'b')])
    expect([...keptChoices(choices, before, after).keys()]).toEqual(['b.txt'])
  })

  test('drops the choices of a file that is gone', () => {
    const before = request('c1', [file('a.txt', 'a'), file('b.txt', 'b')])
    const after = request('c1', [file('a.txt', 'a')])
    expect([...keptChoices(choices, before, after).keys()]).toEqual(['a.txt'])
  })

  test('drops every choice for another commit', () => {
    const files = [file('a.txt', 'a'), file('b.txt', 'b')]
    expect(keptChoices(choices, request('c1', files), request('c2', files)).size).toBe(0)
  })
})
