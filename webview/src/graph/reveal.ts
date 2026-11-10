// A change to scroll to, and the graph that was shown when it was asked for.
export interface PendingReveal<G> {
  commitId: string
  shownIn: G
}

export type RevealStep = 'scroll' | 'wait' | 'drop'

// The host only asks for changes its graph has, and that graph may not have reached the view
// yet. So a reveal waits through the graph it came with, but a newer graph without the row means
// the change is gone (rewritten, or another repository). Kept, it would jump to the change much
// later, should it ever come back.
export function revealStep<G>(reveal: PendingReveal<G>, graph: G, hasRow: boolean): RevealStep {
  if (hasRow) {
    return 'scroll'
  }
  return graph === reveal.shownIn ? 'wait' : 'drop'
}
