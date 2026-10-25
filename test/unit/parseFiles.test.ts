import { describe, expect, test } from 'vitest'
import { parseFiles } from '../../src/jj/parse'

describe('parseFiles', () => {
  test('merges line stats by path and drops empty counts', () => {
    const files = parseFiles(
      `${JSON.stringify({
        files: [
          { path: 'a.txt', status: 'modified', source: 'old.txt' },
          { path: 'bin.dat', status: 'modified', source: 'bin.dat' },
        ],
        conflicted: [],
        stats: [
          { path: 'a.txt', added: 3, removed: 1 },
          { path: 'bin.dat', added: 0, removed: 0 },
          { path: 'missing.txt', added: 9, removed: 9 },
        ],
      })}\n`,
    )

    expect(files).toEqual([
      {
        path: 'a.txt',
        sourcePath: 'old.txt',
        status: 'modified',
        isConflicted: false,
        linesAdded: 3,
        linesRemoved: 1,
      },
      {
        path: 'bin.dat',
        sourcePath: 'bin.dat',
        status: 'modified',
        isConflicted: false,
      },
    ])
  })

  test('leaves conflict-only files without counts', () => {
    const files = parseFiles(
      `${JSON.stringify({
        files: [{ path: 'a.txt', status: 'modified', source: 'a.txt' }],
        conflicted: ['a.txt', 'b.txt'],
        stats: [
          { path: 'a.txt', added: 2, removed: 1 },
          { path: 'b.txt', added: 4, removed: 4 },
        ],
      })}\n`,
    )

    expect(files).toEqual([
      {
        path: 'a.txt',
        sourcePath: 'a.txt',
        status: 'modified',
        isConflicted: true,
        linesAdded: 2,
        linesRemoved: 1,
      },
      { path: 'b.txt', sourcePath: 'b.txt', status: 'modified', isConflicted: true },
    ])
  })

  test('ignores a missing stats field', () => {
    const files = parseFiles(
      `${JSON.stringify({
        files: [{ path: 'a.txt', status: 'added', source: 'a.txt' }],
        conflicted: [],
      })}\n`,
    )

    expect(files).toEqual([
      { path: 'a.txt', sourcePath: 'a.txt', status: 'added', isConflicted: false },
    ])
  })
})
