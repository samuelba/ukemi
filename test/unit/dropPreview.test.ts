import { describe, expect, test } from 'vitest'
import {
  previewDrop,
  type PreviewDrop,
  type PreviewInput,
  type PreviewResult,
} from '../../shared/dropPreview'
import { topoOrder } from '../../shared/topoOrder'

// `~p` is an elided edge to p.
function commit(commitId: string, parents: string[], isImmutable = false): PreviewInput {
  return {
    commitId,
    isImmutable,
    edges: parents.map((p) => ({ id: p.replace(/^~/, ''), isElided: p.startsWith('~') })),
  }
}

// Top to bottom, as jj log shows it:
//   t        a side branch
//   m        merge of y and o
//   o
//   y
//   x
//   b
//   a
const GRAPH = [
  commit('t', ['a']),
  commit('m', ['y', 'o']),
  commit('o', ['a']),
  commit('y', ['x']),
  commit('x', ['b']),
  commit('b', ['a']),
  commit('a', [], true),
]

// GRAPH with a second head h on x and a change u on t, for drops between t and u.
const FORKED = [commit('u', ['t']), commit('h', ['x']), ...GRAPH]

const onto = (
  sourceId: string,
  targetId: string,
  action: PreviewDrop['action'] = 'rebase',
  mode: PreviewDrop['mode'] = 'source',
): PreviewDrop => ({ kind: 'onto', sourceId, targetId, action, mode })

const between = (
  sourceId: string,
  afterId: string,
  beforeId: string,
  action: PreviewDrop['action'] = 'rebase',
  mode: PreviewDrop['mode'] = 'source',
): PreviewDrop => ({ kind: 'between', sourceId, afterId, beforeId, action, mode })

function ok(result: PreviewResult) {
  if (!result.ok) {
    throw new Error(`expected a preview, got ${result.error}`)
  }
  return result
}

function parents(result: PreviewResult, id: string): string[] {
  const node = ok(result).nodes.find((n) => n.id === id)
  if (!node) {
    throw new Error(`no node ${id}`)
  }
  return node.edges.map((e) => (e.isElided ? `~${e.id}` : e.id))
}

const order = (result: PreviewResult) => ok(result).nodes.map((n) => n.id)
const role = (result: PreviewResult, id: string) =>
  ok(result).nodes.find((n) => n.id === id)?.role ?? null

function expectTopological(result: PreviewResult) {
  const ids = order(result)
  for (const node of ok(result).nodes) {
    for (const edge of node.edges) {
      if (ids.includes(edge.id)) {
        expect(ids.indexOf(edge.id), `${edge.id} below ${node.id}`).toBeGreaterThan(
          ids.indexOf(node.id),
        )
      }
    }
  }
}

describe('previewDrop: rebase with descendants', () => {
  const result = previewDrop(GRAPH, onto('x', 't'))

  test('moves the change onto the target and keeps the descendants on it', () => {
    expect(parents(result, 'x')).toEqual(['t'])
    expect(parents(result, 'y')).toEqual(['x'])
    expect(parents(result, 'm')).toEqual(['y', 'o'])
  })

  test('marks the dropped change and the changes it carries', () => {
    expect(role(result, 'x')).toBe('moved')
    expect(role(result, 'y')).toBe('carried')
    expect(role(result, 'm')).toBe('carried')
    expect(role(result, 't')).toBeNull()
  })

  test('leaves faded copies where the changes were', () => {
    expect(parents(result, 'old:x')).toEqual(['b'])
    expect(parents(result, 'old:y')).toEqual(['old:x'])
    expect(parents(result, 'old:m')).toEqual(['old:y', 'o'])
    expect(role(result, 'old:x')).toBe('old')
  })

  test('puts the moved changes right above the target, in a valid order', () => {
    const ids = order(result)
    expect(ids.indexOf('x') + 1).toBe(ids.indexOf('t'))
    expect(ok(result).anchorId).toBe('x')
    expectTopological(result)
  })

  test('lays out every node', () => {
    expect(ok(result).rows.map((row) => row.id)).toEqual(order(result))
  })

  test('summarises what moves where', () => {
    expect(ok(result).summary).toEqual({
      action: 'rebase',
      mode: 'source',
      sourceId: 'x',
      count: 3,
      targetIds: ['t'],
    })
  })

  test('refuses to rebase onto its own descendant', () => {
    expect(previewDrop(GRAPH, onto('x', 'y'))).toEqual({ ok: false, error: 'cycle' })
  })

  test('says when the change already sits on the target', () => {
    expect(previewDrop(GRAPH, onto('x', 'b'))).toEqual({ ok: false, error: 'unchanged' })
    expect(previewDrop(GRAPH, onto('x', 'x', 'rebase', 'revision'))).toEqual({
      ok: false,
      error: 'unchanged',
    })
  })

  test('moves one change off its children onto its own parent', () => {
    const result = previewDrop(GRAPH, onto('x', 'b', 'rebase', 'revision'))
    expect(parents(result, 'x')).toEqual(['b'])
    expect(parents(result, 'y')).toEqual(['b'])
  })

  test('refuses to move an immutable change on top of the dropped one', () => {
    const graph = FORKED.map((c) => (c.commitId === 'u' ? { ...c, isImmutable: true } : c))
    expect(previewDrop(graph, between('x', 't', 'u'))).toEqual({ ok: false, error: 'immutable' })
    expect(previewDrop(graph, between('x', 't', 'u', 'duplicate', 'revision'))).toEqual({
      ok: false,
      error: 'immutable',
    })
  })

  test('refuses to rebase an immutable change', () => {
    const graph = GRAPH.map((c) => (c.commitId === 'b' ? { ...c, isImmutable: true } : c))
    expect(previewDrop(graph, onto('b', 't'))).toEqual({ ok: false, error: 'immutable' })
  })

  test('needs the changes in the graph', () => {
    expect(previewDrop(GRAPH, onto('nope', 't'))).toEqual({ ok: false, error: 'missing' })
    expect(previewDrop(GRAPH, onto('x', 'nope'))).toEqual({ ok: false, error: 'missing' })
  })

  test('can leave out the faded copies', () => {
    const plain = ok(previewDrop(GRAPH, onto('x', 't'), { ghosts: false }))
    expect(plain.nodes.some((n) => n.role === 'old')).toBe(false)
    expect(plain.nodes).toHaveLength(GRAPH.length)
  })
})

describe('previewDrop: rebase of one change', () => {
  const result = previewDrop(GRAPH, onto('y', 't', 'rebase', 'revision'))

  test('moves only the change and hands its children its parents', () => {
    expect(parents(result, 'y')).toEqual(['t'])
    expect(parents(result, 'm')).toEqual(['x', 'o'])
    expect(role(result, 'm')).toBe('reparented')
    expect(parents(result, 'old:y')).toEqual(['x'])
    expectTopological(result)
  })

  test('keeps elided edges elided when children take over the parents', () => {
    const graph = [
      commit('t', ['a']),
      commit('c', ['~x']),
      commit('d', ['x']),
      commit('x', ['~b']),
      commit('b', ['a']),
      commit('a', []),
    ]
    const moved = previewDrop(graph, onto('x', 't', 'rebase', 'revision'))
    expect(parents(moved, 'c')).toEqual(['~b'])
    expect(parents(moved, 'd')).toEqual(['~b'])
  })

  test('drops a parent that the child already has', () => {
    const graph = [
      commit('t', ['a']),
      commit('c', ['x', 'b']),
      commit('x', ['b']),
      commit('b', ['a']),
      commit('a', []),
    ]
    expect(parents(previewDrop(graph, onto('x', 't', 'rebase', 'revision')), 'c')).toEqual(['b'])
  })
})

describe('previewDrop: duplicate', () => {
  test('adds a copy of one change and keeps the original', () => {
    const result = previewDrop(GRAPH, onto('x', 't', 'duplicate', 'revision'))
    expect(parents(result, 'new:x')).toEqual(['t'])
    expect(parents(result, 'x')).toEqual(['b'])
    expect(role(result, 'new:x')).toBe('new')
    expect(ok(result).anchorId).toBe('new:x')
    expect(ok(result).nodes.some((n) => n.role === 'old')).toBe(false)
    expectTopological(result)
  })

  test('copies the descendants and drops parents from outside the copied changes', () => {
    const result = previewDrop(GRAPH, onto('x', 't', 'duplicate', 'source'))
    expect(parents(result, 'new:x')).toEqual(['t'])
    expect(parents(result, 'new:y')).toEqual(['new:x'])
    expect(parents(result, 'new:m')).toEqual(['new:y'])
    expect(ok(result).summary.count).toBe(3)
    expectTopological(result)
  })

  test('may copy an immutable change', () => {
    expect(previewDrop(GRAPH, onto('a', 't', 'duplicate', 'revision')).ok).toBe(true)
  })
})

describe('previewDrop: between two changes', () => {
  test('rebases the change and its descendants in, and the upper change onto their heads', () => {
    const result = previewDrop(FORKED, between('x', 't', 'u'))
    expect(parents(result, 'x')).toEqual(['t'])
    expect(parents(result, 'u').sort()).toEqual(['h', 'm'])
    expect(role(result, 'u')).toBe('reparented')
    expect(ok(result).summary.targetIds).toEqual(['t', 'u'])
    expectTopological(result)
  })

  test('moves one change in and hands its children its parents', () => {
    const result = previewDrop(FORKED, between('y', 't', 'u', 'rebase', 'revision'))
    expect(parents(result, 'y')).toEqual(['t'])
    expect(parents(result, 'u')).toEqual(['y'])
    expect(parents(result, 'm')).toEqual(['x', 'o'])
    expectTopological(result)
  })

  test('duplicates the descendants in, with the upper change on the copied heads', () => {
    const result = previewDrop(FORKED, between('x', 't', 'u', 'duplicate', 'source'))
    expect(parents(result, 'new:x')).toEqual(['t'])
    expect(parents(result, 'u').sort()).toEqual(['new:h', 'new:m'])
    expectTopological(result)
  })

  test('refuses to insert a change between its own descendants', () => {
    expect(previewDrop(FORKED, between('x', 'y', 'm'))).toEqual({ ok: false, error: 'cycle' })
  })
})

describe('topoOrder', () => {
  test('follows the keys where the edges allow it', () => {
    expect(
      topoOrder([
        { id: 'a', key: 2, parents: [] },
        { id: 'b', key: 0, parents: ['a'] },
        { id: 'c', key: 1, parents: ['a'] },
      ]),
    ).toEqual(['b', 'c', 'a'])
  })

  test('keeps a parent below its children whatever its key', () => {
    expect(
      topoOrder([
        { id: 'p', key: 0, parents: [] },
        { id: 'c', key: 5, parents: ['p', 'gone'] },
      ]),
    ).toEqual(['c', 'p'])
  })
})
