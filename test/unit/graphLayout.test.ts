import { describe, expect, test } from 'vitest'
import { layoutGraph, type GraphNodeInput } from '../../shared/graphLayout'

const node = (id: string, ...parents: string[]): GraphNodeInput => ({
  id,
  parents: parents.map((p) => ({ id: p, isElided: false })),
})

describe('layoutGraph', () => {
  test('places a linear history in one column', () => {
    const rows = layoutGraph([node('c', 'b'), node('b', 'a'), node('a')])

    expect(rows.map((r) => r.column)).toEqual([0, 0, 0])
    expect(rows[0]?.incoming).toEqual([])
    expect(rows[1]?.incoming).toEqual([{ fromColumn: 0 }])
    expect(rows[0]?.outgoing).toEqual([{ toColumn: 0, isElided: false }])
    expect(rows[2]?.outgoing).toEqual([])
  })

  test('opens a second lane for a sibling branch', () => {
    const rows = layoutGraph([node('x', 'base'), node('y', 'base'), node('base')])

    expect(rows.map((r) => r.column)).toEqual([0, 1, 0])
    expect(rows[1]?.passThrough).toEqual([{ column: 0, isElided: false }])
    expect(rows[1]?.outgoing).toEqual([{ toColumn: 0, isElided: false }])
    expect(rows[2]?.incoming).toEqual([{ fromColumn: 0 }])
  })

  test('routes a merge commit to two lanes', () => {
    const rows = layoutGraph([node('m', 'a', 'b'), node('a', 'r'), node('b', 'r'), node('r')])

    expect(rows[0]?.outgoing).toEqual([
      { toColumn: 0, isElided: false },
      { toColumn: 1, isElided: false },
    ])
    expect(rows.map((r) => r.column)).toEqual([0, 0, 1, 0])
    expect(rows[3]?.incoming).toEqual([{ fromColumn: 0 }])
    expect(rows[2]?.outgoing).toEqual([{ toColumn: 0, isElided: false }])
  })

  test('keeps elided edges marked as elided', () => {
    const rows = layoutGraph([
      { id: 'top', parents: [{ id: 'trunk', isElided: true }] },
      node('trunk'),
    ])

    expect(rows[0]?.outgoing).toEqual([{ toColumn: 0, isElided: true }])
  })

  test('reports the width needed for each row', () => {
    const rows = layoutGraph([node('x', 'base'), node('y', 'base'), node('z', 'base'), node('base')])

    expect(rows.map((r) => r.width)).toEqual([1, 2, 2, 1])
    expect(rows.map((r) => r.column)).toEqual([0, 1, 1, 0])
  })

  test('reuses a freed lane for the next head', () => {
    const rows = layoutGraph([node('a'), node('b')])

    expect(rows.map((r) => r.column)).toEqual([0, 0])
  })
})
