import { describe, expect, test } from 'vitest'
import { graphFromAncestors, MAX_ELIDED_LOOKUPS, ROOT_COMMIT_ID } from '../../src/graph/buildGraph'
import { layoutGraph } from '../../shared/graphLayout'
import type { Commit } from '../../shared/model'

function commit(commitId: string, parents: string[]): Commit {
  return {
    changeId: `change-${commitId}`,
    changePrefix: 'c',
    commitId,
    commitPrefix: commitId.slice(0, 1),
    parents,
    description: '',
    author: { name: '', email: '', timestamp: '' },
    committer: { name: '', email: '', timestamp: '' },
    localBookmarks: [],
    remoteBookmarks: [],
    tags: [],
    workingCopies: [],
    changeOffset: null,
    isWorkingCopy: false,
    isEmpty: false,
    hasConflict: false,
    isImmutable: false,
    isDivergent: false,
    isHidden: false,
    isMine: true,
  }
}

describe('graphFromAncestors', () => {
  test('keeps direct edges between displayed commits', () => {
    const { nodes, missing } = graphFromAncestors(
      [commit('b', ['a']), commit('a', [])],
      () => undefined,
    )

    expect(nodes[0]?.parents).toEqual([{ id: 'a', isElided: false }])
    expect(missing).toEqual([])
  })

  test('replaces hidden parents with elided edges to displayed ancestors', () => {
    const asked: string[] = []
    const { nodes } = graphFromAncestors([commit('top', ['hidden']), commit('trunk', [])], (p) => {
      asked.push(p)
      return ['trunk']
    })

    expect(asked).toEqual(['hidden'])
    expect(nodes[0]?.parents).toEqual([{ id: 'trunk', isElided: true }])
  })

  test('drops ancestors that are not displayed, such as those of a stale cache entry', () => {
    const { nodes } = graphFromAncestors([commit('top', ['hidden'])], () => ['gone'])

    expect(nodes[0]?.parents).toEqual([])
  })

  test('reports parents without an answer as missing, and skips the root commit', () => {
    const { nodes, missing } = graphFromAncestors(
      [commit('a', [ROOT_COMMIT_ID, 'x'])],
      () => undefined,
    )

    expect(missing).toEqual(['x'])
    expect(nodes[0]?.parents).toEqual([])
  })

  test('deduplicates edges that resolve to the same ancestor', () => {
    const { nodes } = graphFromAncestors([commit('m', ['h1', 'h2']), commit('base', [])], () => [
      'base',
    ])

    expect(nodes[0]?.parents).toEqual([{ id: 'base', isElided: true }])
  })

  test('keeps a plain edge to a cut-off parent and does not look it up', () => {
    const asked: string[] = []
    const { nodes, missing } = graphFromAncestors(
      [commit('b', ['a']), commit('a', ['past-end'])],
      (p) => {
        asked.push(p)
        return undefined
      },
      new Set(['past-end']),
    )

    expect(asked).toEqual([])
    expect(missing).toEqual([])
    expect(nodes[1]?.parents).toEqual([{ id: 'past-end', isElided: false }])
  })

  test('a cut-off edge runs off the bottom of the layout', () => {
    const { nodes } = graphFromAncestors(
      [commit('b', ['a', 'side']), commit('a', ['past-end'])],
      () => undefined,
      new Set(['side', 'past-end']),
    )
    const rows = layoutGraph(nodes)

    expect(rows[1]?.passThrough).toEqual([{ column: 1, isElided: false }])
    expect(rows[1]?.outgoing).toEqual([{ toColumn: 0, isElided: false }])
  })

  test('counts the hidden parents past the lookup limit', () => {
    const parents = Array.from({ length: MAX_ELIDED_LOOKUPS + 3 }, (_, i) => `h${i}`)
    const asked: string[] = []
    const { dropped } = graphFromAncestors([commit('m', parents)], (p) => {
      asked.push(p)
      return []
    })

    expect(asked).toHaveLength(MAX_ELIDED_LOOKUPS)
    expect(asked[0]).toBe('h0')
    expect(dropped).toBe(3)
  })
})
