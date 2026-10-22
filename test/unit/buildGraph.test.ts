import { describe, expect, test } from 'vitest'
import { buildGraphNodes, ROOT_COMMIT_ID } from '../../src/graph/buildGraph'
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
    isPushed: false,
  }
}

describe('buildGraphNodes', () => {
  test('keeps direct edges between displayed commits', async () => {
    const nodes = await buildGraphNodes([commit('b', ['a']), commit('a', [])], async () => [])

    expect(nodes[0]?.parents).toEqual([{ id: 'a', isElided: false }])
  })

  test('replaces hidden parents with elided edges to displayed ancestors', async () => {
    const lookups: string[] = []
    const nodes = await buildGraphNodes(
      [commit('top', ['hidden']), commit('trunk', [])],
      async (parent) => {
        lookups.push(parent)
        return ['trunk']
      },
    )

    expect(lookups).toEqual(['hidden'])
    expect(nodes[0]?.parents).toEqual([{ id: 'trunk', isElided: true }])
  })

  test('skips the root commit and failed lookups', async () => {
    const nodes = await buildGraphNodes([commit('a', [ROOT_COMMIT_ID, 'x'])], async () => {
      throw new Error('boom')
    })

    expect(nodes[0]?.parents).toEqual([])
  })

  test('deduplicates edges that resolve to the same ancestor', async () => {
    const nodes = await buildGraphNodes(
      [commit('m', ['h1', 'h2']), commit('base', [])],
      async () => ['base'],
    )

    expect(nodes[0]?.parents).toEqual([{ id: 'base', isElided: true }])
  })
})
