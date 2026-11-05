import { describe, expect, test } from 'vitest'
import type { Operation } from '../../shared/model'
import type { CommitView, GraphState } from '../../shared/protocol'
import {
  onlySnapshotsSince,
  snapshotPageRevset,
  type SnapshotPageInput,
} from '../../src/repo/refreshRevsets'

const operation = (id: string, description = 'snapshot working copy'): Operation =>
  ({ id, description, user: 'u', time: '' }) as Operation

const commit = (changeId: string, extra: Partial<CommitView> = {}): CommitView =>
  ({
    commitId: `${changeId}-id`,
    changeId,
    isHidden: false,
    isDivergent: false,
    ...extra,
  }) as CommitView

function input(
  overrides: Partial<SnapshotPageInput> = {},
  graph: Partial<GraphState> = {},
): SnapshotPageInput {
  const shown = {
    commits: [commit('aaa'), commit('bbb')],
    operationId: 'op1',
    filter: 'mine',
    depth: '7d',
    revset: null,
    isTruncated: false,
    ...graph,
  } as GraphState
  return {
    view: { filter: 'mine', depth: '7d', revset: null },
    shown,
    shownOperation: 'op1',
    operations: [operation('op2'), operation('op1', 'describe commit')],
    ...overrides,
  }
}

describe('snapshotPageRevset', () => {
  test('names the shown changes and keeps the revset as a filter', () => {
    expect(snapshotPageRevset(input(), 'R')).toBe(
      '(change_id(aaa) | change_id(bbb) | working_copies()::) & (R)',
    )
  })

  test('names a hidden commit by its commit id', () => {
    const page = snapshotPageRevset(
      input({}, { commits: [commit('aaa', { isHidden: true })] }),
      'R',
    )
    expect(page).toBe('(aaa-id | working_copies()::) & (R)')
  })

  test('reads from the revset when the shortcut cannot be checked', () => {
    const cases: Array<[string, SnapshotPageInput]> = [
      ['no graph yet', input({ shown: null })],
      [
        'another operation',
        input({ operations: [operation('op2', 'describe commit'), operation('op1')] }),
      ],
      ['a graph of an older operation', input({}, { operationId: 'op0' })],
      ['another view', input({ view: { filter: 'stack', depth: '7d', revset: null } })],
      [
        'a date window on Recent',
        input({ view: { filter: 'recent', depth: '7d', revset: null } }, { filter: 'recent' }),
      ],
      [
        'a typed revset',
        input({ view: { filter: 'mine', depth: '7d', revset: 'x' } }, { revset: 'x' }),
      ],
      ['a truncated graph', input({}, { isTruncated: true })],
      ['a divergent change', input({}, { commits: [commit('aaa', { isDivergent: true })] })],
    ]
    for (const [name, value] of cases) {
      expect(snapshotPageRevset(value, 'R'), name).toBeNull()
    }
  })
})

describe('onlySnapshotsSince', () => {
  test('holds for snapshots straight after the operation, and not for none or others', () => {
    const ops = [operation('c'), operation('b'), operation('a', 'describe commit')]
    expect(onlySnapshotsSince(ops, 'a')).toBe(true)
    expect(onlySnapshotsSince(ops, 'c')).toBe(false)
    expect(onlySnapshotsSince(ops, 'zzz')).toBe(false)
    expect(onlySnapshotsSince(ops, null)).toBe(false)
    expect(onlySnapshotsSince([operation('b', 'new empty commit'), ...ops.slice(1)], 'a')).toBe(
      false,
    )
  })
})
