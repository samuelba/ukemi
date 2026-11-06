import { describe, expect, test } from 'vitest'
import type { PreviewDrop, PreviewSummary } from '../../shared/dropPreview'
import type { CommitView, GraphState, ViewState } from '../../shared/protocol'
import {
  applyPending,
  dropMessage,
  errorText,
  nextPending,
  previewText,
  resolvePending,
  startPending,
} from '../../webview/src/graph/pendingDrop'

function commit(commitId: string, changeId: string): CommitView {
  return { commitId, changeId } as CommitView
}

function graph(commits: CommitView[], overrides: Partial<GraphState> = {}): GraphState {
  return {
    repoId: '/repo',
    commits,
    filter: 'recent',
    depth: '7d',
    revset: null,
    operationId: 'op1',
    ...overrides,
  } as GraphState
}

function state(g: GraphState | null, busy: string | null = null): ViewState {
  return { graph: g, busy, error: null } as ViewState
}

const COMMITS = [commit('c-x', 'x'), commit('c-t', 't'), commit('c-u', 'u')]
const ONTO: PreviewDrop = {
  kind: 'onto',
  sourceId: 'c-x',
  targetId: 'c-t',
  action: 'rebase',
  mode: 'source',
}
const BETWEEN: PreviewDrop = {
  kind: 'between',
  sourceId: 'c-x',
  afterId: 'c-t',
  beforeId: 'c-u',
  action: 'duplicate',
  mode: 'revision',
}

describe('pending drops', () => {
  test('follow their changes to new commit ids', () => {
    const pending = startPending(ONTO, graph(COMMITS))
    const moved = [commit('c-x2', 'x'), commit('c-t', 't')]
    expect(pending && resolvePending(pending, moved)).toEqual({ ...ONTO, sourceId: 'c-x2' })
    expect(pending && resolvePending(pending, moved.slice(1))).toBeNull()
  })

  test('give up on a divergent change', () => {
    const pending = startPending(ONTO, graph(COMMITS))
    const divergent = [...COMMITS, commit('c-x3', 'x')]
    expect(pending && resolvePending(pending, divergent)).toBeNull()
  })

  test('resolve both changes of a drop between two', () => {
    const pending = startPending(BETWEEN, graph(COMMITS))
    expect(pending && resolvePending(pending, COMMITS)).toEqual(BETWEEN)
  })

  test('need the changes in the graph to start', () => {
    expect(startPending({ ...ONTO, targetId: 'gone' }, graph(COMMITS))).toBeNull()
  })

  test('stay while the changes stay', () => {
    const pending = startPending(ONTO, graph(COMMITS))
    expect(pending && nextPending(pending, state(graph(COMMITS, { operationId: 'op2' })))).toBe(
      pending,
    )
  })

  test('end when the repository, the view or the changes go', () => {
    const pending = startPending(ONTO, graph(COMMITS))
    if (!pending) {
      throw new Error('no pending drop')
    }
    expect(nextPending(pending, state(null))).toBeNull()
    expect(nextPending(pending, state(graph(COMMITS, { repoId: '/other' })))).toBeNull()
    expect(nextPending(pending, state(graph(COMMITS, { revset: 'all()' })))).toBeNull()
    expect(nextPending(pending, state(graph(COMMITS.slice(1))))).toBeNull()
  })

  test('end once jj has run the applied drop', () => {
    const pending = startPending(ONTO, graph(COMMITS))
    if (!pending) {
      throw new Error('no pending drop')
    }
    const applying = applyPending(pending)
    expect(applying.phase).toBe('applying')
    expect(nextPending(applying, state(graph(COMMITS)))).toBe(applying)
    const running = nextPending(applying, state(graph(COMMITS), 'Rebase'))
    expect(running?.sawBusy).toBe(true)
    expect(
      running && nextPending(running, state(graph(COMMITS, { operationId: 'op3' }))),
    ).toBeNull()
  })

  test('outlast a snapshot that lands before jj starts', () => {
    const pending = startPending(ONTO, graph(COMMITS))
    if (!pending) {
      throw new Error('no pending drop')
    }
    const applying = applyPending(pending)
    const snapshot = state(graph(COMMITS, { operationId: 'op2' }))
    expect(nextPending(applying, snapshot)).toBe(applying)
  })
})

describe('dropMessage', () => {
  test('is the message a drop sends without a preview', () => {
    expect(dropMessage(ONTO)).toEqual({
      type: 'dropCommit',
      sourceId: 'c-x',
      targetId: 'c-t',
      action: 'rebase',
      mode: 'source',
    })
    expect(dropMessage(BETWEEN)).toEqual({
      type: 'insertCommit',
      sourceId: 'c-x',
      afterId: 'c-t',
      beforeId: 'c-u',
      action: 'duplicate',
      mode: 'revision',
    })
  })
})

describe('previewText', () => {
  const label = (id: string) => id.replace('c-', '')

  test('names the changes and where they go', () => {
    const summary: Omit<PreviewSummary, 'count'> = {
      action: 'rebase',
      mode: 'source',
      sourceId: 'c-x',
      targetIds: ['c-t'],
    }
    expect(previewText({ ...summary, count: 3 }, label)).toBe(
      'Rebase “x” and 2 descendants onto “t”',
    )
    expect(previewText({ ...summary, count: 2 }, label)).toBe(
      'Rebase “x” and 1 descendant onto “t”',
    )
    expect(previewText({ ...summary, count: 1 }, label)).toBe('Rebase “x” onto “t”')
  })

  test('says when a change moves without its children', () => {
    expect(
      previewText(
        { action: 'rebase', mode: 'revision', sourceId: 'c-y', count: 1, targetIds: ['c-t'] },
        label,
      ),
    ).toBe('Rebase only “y” onto “t”')
  })

  test('describes a copy between two changes', () => {
    expect(
      previewText(
        {
          action: 'duplicate',
          mode: 'revision',
          sourceId: 'c-x',
          count: 1,
          targetIds: ['c-t', 'c-u'],
        },
        label,
      ),
    ).toBe('Duplicate “x” between “t” and “u”')
  })

  test('explains why a drop cannot run', () => {
    expect(errorText('cycle', '“x”')).toBe('“x” cannot go onto its own descendants.')
    expect(errorText('unchanged', '“x”')).toBe('“x” is already there.')
  })
})
