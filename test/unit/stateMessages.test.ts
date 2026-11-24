import { describe, expect, test } from 'vitest'
import type { GraphState, ViewState } from '../../shared/protocol'
import { StateMessages } from '../../src/desktop/stateMessages'
import { receivedState } from '../../webview/src/shared/receivedState'

function state(graph: GraphState | null, busy: string | null = null): ViewState {
  return { graph, busy } as ViewState
}

const graph = { repoId: '/repo', commits: [] } as unknown as GraphState
const other = { repoId: '/repo', commits: [] } as unknown as GraphState

describe('StateMessages', () => {
  test('sends the graph the first time', () => {
    expect(new StateMessages().next(state(graph))).toEqual({ type: 'state', state: state(graph) })
  })

  test('leaves out a graph the window already has', () => {
    const messages = new StateMessages()
    messages.next(state(graph))

    expect(messages.next(state(graph, 'Fetch'))).toEqual({
      type: 'state',
      state: state(null, 'Fetch'),
      graphUnchanged: true,
    })
  })

  test('sends a new graph and a graph that went away', () => {
    const messages = new StateMessages()
    messages.next(state(graph))

    expect(messages.next(state(other)).state.graph).toBe(other)
    expect(messages.next(state(null))).toEqual({ type: 'state', state: state(null) })
  })

  test('sends the graph again to a window that reloaded', () => {
    const messages = new StateMessages()
    messages.next(state(graph))
    messages.forget()

    expect(messages.next(state(graph)).state.graph).toBe(graph)
  })
})

describe('receivedState', () => {
  test('keeps the graph the host left out', () => {
    const shown = state(graph)

    const next = receivedState(shown, {
      type: 'state',
      state: state(null, 'Fetch'),
      graphUnchanged: true,
    })

    expect(next).toEqual(state(graph, 'Fetch'))
    expect(next.graph).toBe(graph)
  })

  test('takes a state with its graph as it is', () => {
    const message = { type: 'state' as const, state: state(other) }

    expect(receivedState(state(graph), message)).toBe(message.state)
  })
})
