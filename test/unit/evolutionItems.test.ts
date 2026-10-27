import { describe, expect, test } from 'vitest'
import type { EvolutionEntry } from '../../shared/model'
import { evolutionVersionNodes } from '../../src/repo/evolutionItems'

const NOW = Date.parse('2026-10-24T12:00:00Z')

function entry(commitId: string, parents: string[], operation: string): EvolutionEntry {
  return {
    commitId,
    commitPrefix: commitId.slice(0, 2),
    parents,
    description: '',
    timestamp: '2026-10-24T10:00:00Z',
    isEmpty: false,
    operation,
  }
}

const commit = {
  repoId: '/repo',
  commitId: 'current-commit',
  changeId: 'change-1',
  isImmutable: false,
}

describe('evolutionVersionNodes', () => {
  const entries = [
    entry('ccc', ['p1'], 'snapshot working copy'),
    entry('bbb', ['p1'], 'describe commit'),
    entry('aaa', ['p0'], 'commit aaa'),
  ]

  test('marks the newest version current and the older ones comparable', () => {
    const nodes = evolutionVersionNodes(entries, commit, { now: NOW, changeIdLength: 3 })

    expect(nodes.map((node) => node.label)).toEqual(['ccc', 'bbb', 'aaa'])
    expect(nodes[0]?.description).toBe('current snapshot working copy 2h')
    expect(nodes[0]?.contextValue).toBe('version:openable')
    expect(nodes[0]?.previousCommitId).toBe('bbb')
    expect(nodes[1]?.contextValue).toBe('version:openable:comparable:restorable')
    expect(nodes[1]?.previousCommitId).toBe('aaa')
    expect(nodes[2]?.contextValue).toBe('version:comparable')
    expect(nodes[2]?.previousCommitId).toBeNull()
  })

  test('hides restore on an immutable change', () => {
    const nodes = evolutionVersionNodes(
      entries,
      { ...commit, isImmutable: true },
      {
        now: NOW,
        changeIdLength: 3,
      },
    )

    expect(nodes[1]?.contextValue).toBe('version:openable:comparable')
  })

  test('gives the only version no actions', () => {
    const nodes = evolutionVersionNodes([entries[0]!], commit, { now: NOW, changeIdLength: 3 })

    expect(nodes[0]?.contextValue).toBe('version')
    expect(nodes[0]?.previousCommitId).toBeNull()
  })
})
