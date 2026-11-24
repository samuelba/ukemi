import type { GraphState, HostMessage, ViewState } from '../../shared/protocol'

type StateMessage = Extract<HostMessage, { type: 'state' }>

// The graph is most of a state message, and most changes leave it as it was: a busy label, an
// auto-fetch, a tab. A graph the window already has is left out, so it is not copied again.
export class StateMessages {
  private sent: GraphState | null | undefined = undefined

  // The window loaded again and has no graph.
  forget(): void {
    this.sent = undefined
  }

  next(state: ViewState): StateMessage {
    if (state.graph !== null && state.graph === this.sent) {
      return { type: 'state', state: { ...state, graph: null }, graphUnchanged: true }
    }
    this.sent = state.graph
    return { type: 'state', state }
  }
}
