import type { HostMessage, ViewState } from '../../../shared/protocol'

// The state a state message describes, with the graph the host left out because it was shown.
export function receivedState(
  shown: ViewState | null,
  message: Extract<HostMessage, { type: 'state' }>,
): ViewState {
  return message.graphUnchanged && shown ? { ...message.state, graph: shown.graph } : message.state
}
