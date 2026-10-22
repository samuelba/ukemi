import { describe, expect, test } from 'vitest'
import { canRestoreVersion, operationLabel } from '../../shared/evolution'
import type { EvolutionEntry } from '../../shared/model'
import { parseEvolution } from '../../src/jj/parse'

function entry(commitId: string, parents: string[]): EvolutionEntry {
  return {
    commitId,
    commitPrefix: commitId.slice(0, 2),
    parents,
    description: '',
    timestamp: '2026-10-22T20:00:00+02:00',
    isEmpty: false,
    operation: '',
  }
}

describe('canRestoreVersion', () => {
  const entries = [entry('c3', ['p1', 'p2']), entry('c2', ['p2', 'p1']), entry('c1', ['p0'])]

  test('allows an older version with the same parents', () => {
    expect(canRestoreVersion(entries, 1)).toBe(true)
  })

  test('refuses the current version', () => {
    expect(canRestoreVersion(entries, 0)).toBe(false)
  })

  test('refuses a version with other parents', () => {
    expect(canRestoreVersion(entries, 2)).toBe(false)
  })

  test('refuses an index outside the list', () => {
    expect(canRestoreVersion(entries, 3)).toBe(false)
  })
})

describe('operationLabel', () => {
  test('shortens full commit ids', () => {
    expect(operationLabel('commit d0d80cf130190198bdd19c991673d69d6aa24f49')).toBe(
      'commit d0d80cf1',
    )
  })

  test('names versions without an operation', () => {
    expect(operationLabel('')).toBe('(unknown operation)')
  })
})

describe('parseEvolution', () => {
  test('maps jj output to entries', () => {
    const line = JSON.stringify({
      commit_id: 'abc',
      commit_prefix: 'a',
      parents: ['p'],
      description: 'msg\n',
      timestamp: '2026-10-22T20:00:00+02:00',
      is_empty: false,
      operation: 'snapshot working copy',
    })
    expect(parseEvolution(`${line}\n`)).toEqual([
      {
        commitId: 'abc',
        commitPrefix: 'a',
        parents: ['p'],
        description: 'msg\n',
        timestamp: '2026-10-22T20:00:00+02:00',
        isEmpty: false,
        operation: 'snapshot working copy',
      },
    ])
  })

  test('rejects unexpected output', () => {
    expect(() => parseEvolution('{"commit_id": 1}\n')).toThrow(/evolution/)
  })
})
