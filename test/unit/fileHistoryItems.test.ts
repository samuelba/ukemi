import { describe, expect, test } from 'vitest'
import type { Commit } from '../../shared/model'
import { parseAnnotation } from '../../src/jj/parse'
import { blameLabel, blameRuns, fileHistoryEntry } from '../../src/repo/fileHistoryItems'

function line(commitId: string, n: number) {
  return { commitId, changeId: `${commitId}-change`, line: n }
}

describe('blameRuns', () => {
  test('joins neighbouring lines of one change into a run', () => {
    expect(blameRuns([line('a', 1), line('a', 2), line('b', 3), line('a', 4)])).toEqual([
      { start: 1, count: 2, commitId: 'a' },
      { start: 3, count: 1, commitId: 'b' },
      { start: 4, count: 1, commitId: 'a' },
    ])
  })

  test('an empty file has no runs', () => {
    expect(blameRuns([])).toEqual([])
  })
})

describe('parseAnnotation', () => {
  test('reads one JSON line per file line', () => {
    const output =
      '{"commit_id":"abc","change_id":"xyz","line":1}\n{"commit_id":"def","change_id":"uvw","line":2}\n'
    expect(parseAnnotation(output)).toEqual([
      { commitId: 'abc', changeId: 'xyz', line: 1 },
      { commitId: 'def', changeId: 'uvw', line: 2 },
    ])
  })
})

describe('fileHistoryEntry', () => {
  const commit = {
    commitId: '4972915f76686ddd',
    commitPrefix: '49',
    changeId: 'kxyzabcd',
    changePrefix: 'kx',
    description: 'fix: the cart\n\nbody',
    author: { name: 'Ada', email: 'ada@example.com', timestamp: '2026-10-24T10:00:00Z' },
    isWorkingCopy: false,
    isMine: false,
  } as Commit

  test('describes the change with its title, short id and author', () => {
    const entry = fileHistoryEntry('/repo', 'src/cart.ts', commit, 4)
    expect(entry).toMatchObject({
      kind: 'fileHistory',
      repoId: '/repo',
      path: 'src/cart.ts',
      shortChangeId: 'kxyz',
      shortCommitId: '4972915f',
      summary: 'fix: the cart',
      author: 'Ada',
      isMine: false,
    })
  })

  test('labels a blamed line with who, when, what, and the change and commit ids', () => {
    const entry = fileHistoryEntry('/repo', 'a', commit, 4)
    expect(blameLabel(entry, '3d')).toBe('Ada · 3d · fix: the cart · kxyz 4972915f')
    expect(blameLabel({ ...entry, summary: '' }, '3d')).toBe(
      'Ada · 3d · (no description) · kxyz 4972915f',
    )
    expect(blameLabel({ ...entry, isWorkingCopy: true }, 'now')).toBe(
      'Working copy · not committed yet · kxyz',
    )
  })

  test('says You for the changes of the current user', () => {
    const entry = fileHistoryEntry('/repo', 'a', { ...commit, isMine: true }, 4)
    expect(blameLabel(entry, '3d')).toBe('You · 3d · fix: the cart · kxyz 4972915f')
  })
})
