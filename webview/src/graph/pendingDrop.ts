import type { PreviewDrop, PreviewError, PreviewSummary } from '../../../shared/dropPreview'
import type { CommitView, GraphState, ViewState, WebviewMessage } from '../../../shared/protocol'

// A dropped change waiting for Apply or Cancel. It holds change ids, since a snapshot of the
// working copy gives it a new commit id while the preview is open.
export interface PendingDrop {
  drop: PreviewDrop
  changes: readonly string[]
  repoId: string
  view: string
  phase: 'preview' | 'applying'
  // jj has started on the applied drop.
  sawBusy: boolean
}

const viewOf = (graph: GraphState) => `${graph.filter}\0${graph.depth}\0${graph.revset ?? ''}`

// The commit ids of a drop, in the order `withIds` takes them.
function idsOf(drop: PreviewDrop): string[] {
  return drop.kind === 'onto'
    ? [drop.sourceId, drop.targetId]
    : [drop.sourceId, drop.afterId, drop.beforeId]
}

function withIds(
  drop: PreviewDrop,
  [sourceId = '', first = '', second = '']: string[],
): PreviewDrop {
  return drop.kind === 'onto'
    ? { ...drop, sourceId, targetId: first }
    : { ...drop, sourceId, afterId: first, beforeId: second }
}

export function startPending(drop: PreviewDrop, graph: GraphState): PendingDrop | null {
  const changes = idsOf(drop).map(
    (id) => graph.commits.find((commit) => commit.commitId === id)?.changeId,
  )
  if (changes.some((change) => change === undefined)) {
    return null
  }
  return {
    drop,
    changes: changes.filter((change) => change !== undefined),
    repoId: graph.repoId,
    view: viewOf(graph),
    phase: 'preview',
    sawBusy: false,
  }
}

// The drop with the current commit ids of its changes, or null when one is gone or divergent.
export function resolvePending(
  pending: PendingDrop,
  commits: readonly CommitView[],
): PreviewDrop | null {
  const ids = pending.changes.map((change) => {
    const matches = commits.filter((commit) => commit.changeId === change)
    return matches.length === 1 ? matches[0]?.commitId : undefined
  })
  return ids.every((id) => id !== undefined) ? withIds(pending.drop, ids) : null
}

export function applyPending(pending: PendingDrop): PendingDrop {
  return { ...pending, phase: 'applying', sawBusy: false }
}

// The pending drop after the host sends a new state, or null when it is over.
export function nextPending(pending: PendingDrop, state: ViewState): PendingDrop | null {
  const graph = state.graph
  if (!graph || graph.repoId !== pending.repoId || viewOf(graph) !== pending.view) {
    return null
  }
  if (pending.phase === 'preview') {
    return resolvePending(pending, graph.commits) ? pending : null
  }
  // A snapshot of the working copy can land before jj starts, so a new operation alone does not
  // end it. jj has run once the host was busy and is idle again. A timeout in the graph covers a
  // host that never reports busy.
  if (state.busy !== null) {
    return pending.sawBusy ? pending : { ...pending, sawBusy: true }
  }
  return pending.sawBusy ? null : pending
}

export function dropMessage(drop: PreviewDrop): WebviewMessage {
  const { sourceId, action, mode } = drop
  return drop.kind === 'onto'
    ? { type: 'dropCommit', sourceId, targetId: drop.targetId, action, mode }
    : {
        type: 'insertCommit',
        sourceId,
        afterId: drop.afterId,
        beforeId: drop.beforeId,
        action,
        mode,
      }
}

const quoted = (text: string) => `“${text}”`

export function previewText(summary: PreviewSummary, label: (commitId: string) => string): string {
  const verb = summary.action === 'rebase' ? 'Rebase' : 'Duplicate'
  const source = quoted(label(summary.sourceId))
  const others = summary.count - 1
  const subject =
    summary.mode === 'revision'
      ? summary.action === 'rebase'
        ? `only ${source}`
        : source
      : others > 0
        ? `${source} and ${others} descendant${others === 1 ? '' : 's'}`
        : source
  const [first = '', second] = summary.targetIds.map((id) => quoted(label(id)))
  const place = second === undefined ? `onto ${first}` : `between ${first} and ${second}`
  return `${verb} ${subject} ${place}`
}

export function errorText(error: PreviewError, source: string): string {
  switch (error) {
    case 'cycle':
      return `${source} cannot go onto its own descendants.`
    case 'immutable':
      return `${source} or a change that moves with it is immutable.`
    case 'unchanged':
      return `${source} is already there.`
    case 'missing':
      return 'The change is no longer in the graph.'
  }
}
