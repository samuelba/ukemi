import { relativeTime, shortId, title } from './format'
import { staleRequestsNote } from './forgeStale'
import type { BookmarkTracking } from './model'
import type { CiState, CommitView, GraphState, ViewState } from './protocol'

const PREFERRED_REMOTE = 'origin'
const SHORT_HASH_LENGTH = 12

export type StatusTone = 'normal' | 'muted' | 'warning' | 'error'

export type StatusAction =
  | { kind: 'reveal'; commitId: string }
  // Reveals the change and opens its first conflicted file.
  | { kind: 'resolve'; commitId: string }
  // The context menu of a bookmark badge in the graph.
  | { kind: 'bookmarkMenu'; context: Record<string, unknown> }
  | { kind: 'command'; command: string }
  | { kind: 'openUrl'; url: string }
  | { kind: 'showLog' }

export interface StatusItem {
  id: 'change' | 'bookmark' | 'conflicts' | 'request' | 'sync' | 'error'
  side: 'left' | 'right'
  icon: string
  // An id or a name, shown in the editor font before the text.
  code?: string
  text: string
  tooltip: string
  tone: StatusTone
  isSpinning?: boolean
  action: StatusAction | null
}

const CI_ICONS: Readonly<Record<CiState, string>> = {
  pending: 'loading',
  success: 'check',
  failure: 'error',
  manual: 'debug-pause',
  skipped: 'circle-slash',
  none: 'git-pull-request',
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function joinLines(lines: readonly string[]): string {
  return lines.filter(Boolean).join('\n')
}

function changeItem(workingCopy: CommitView, idLength: number): StatusItem {
  const id = shortId(workingCopy.changeId, workingCopy.changePrefix, idLength)
  const subject = title(workingCopy.description) || '(no description)'
  const flags = [
    workingCopy.hasConflict ? 'conflicted' : '',
    workingCopy.isDivergent ? 'divergent' : '',
  ].filter(Boolean)
  const isFlagged = flags.length > 0
  return {
    id: 'change',
    side: 'left',
    icon: isFlagged ? 'warning' : 'git-commit',
    code: id,
    text: subject,
    tooltip: joinLines([
      `Working copy ${workingCopy.changeId}${isFlagged ? ` (${flags.join(', ')})` : ''}`,
      `Commit ${workingCopy.commitId.slice(0, SHORT_HASH_LENGTH)}`,
      'Click to show it in the graph',
    ]),
    tone: isFlagged ? 'warning' : 'normal',
    action: { kind: 'reveal', commitId: workingCopy.commitId },
  }
}

interface StatusBookmark {
  name: string
  // Null when the bookmarked change is outside the graph, past its depth or filter.
  commit: CommitView | null
  others: string[]
}

// The bookmark the working copy is on, else the nearest ones below it.
function statusBookmark(graph: GraphState, workingCopy: CommitView): StatusBookmark | null {
  const [own, ...ownOthers] = workingCopy.localBookmarks.map((b) => b.name)
  if (own !== undefined) {
    return { name: own, commit: workingCopy, others: ownOthers }
  }
  const [nearest, ...others] = graph.currentBookmarks
  if (nearest === undefined) {
    return null
  }
  const commit = graph.commits.find((c) => c.localBookmarks.some((b) => b.name === nearest))
  return { name: nearest, commit: commit ?? null, others }
}

// A tracked remote says more than an untracked one, even when the untracked one is origin.
function pickRemote(rows: readonly BookmarkTracking[]): BookmarkTracking | undefined {
  return (
    rows.find((row) => row.tracked && row.remote === PREFERRED_REMOTE) ??
    rows.find((row) => row.tracked) ??
    rows.find((row) => row.remote === PREFERRED_REMOTE) ??
    rows[0]
  )
}

interface TrackingText {
  text: string
  tooltip: string
  tone: StatusTone
}

function trackingText(graph: GraphState, bookmark: StatusBookmark): TrackingText {
  const { name } = bookmark
  const local = bookmark.commit?.localBookmarks.find((b) => b.name === name)
  if (local?.conflict) {
    return { text: 'conflicted', tooltip: `${name} is conflicted`, tone: 'warning' }
  }
  if (!graph.hasRemotes) {
    return { text: '', tooltip: 'The repository has no remote', tone: 'normal' }
  }
  const remote = pickRemote(graph.tracking.filter((row) => row.name === name))
  if (!remote) {
    return { text: 'local only', tooltip: `${name} was never pushed`, tone: 'normal' }
  }
  if (!remote.tracked) {
    const tooltip = `${name}@${remote.remote} exists but is not tracked`
    return { text: 'untracked', tooltip, tone: 'normal' }
  }
  return {
    text: `↑${remote.ahead} ↓${remote.behind}`,
    tooltip:
      `${plural(remote.ahead, 'commit')} to push and ` +
      `${plural(remote.behind, 'commit')} to pull from ${remote.remote}`,
    tone: 'normal',
  }
}

function trunkItem(graph: GraphState): StatusItem | null {
  if (!graph.trunkName) {
    return null
  }
  return {
    id: 'bookmark',
    side: 'left',
    icon: 'git-branch',
    code: graph.trunkName,
    text: '',
    tooltip: `No bookmark on this stack. It is based on ${graph.trunkName}.`,
    tone: 'muted',
    action: null,
  }
}

function bookmarkItem(graph: GraphState, bookmark: StatusBookmark | null): StatusItem | null {
  if (!bookmark) {
    return trunkItem(graph)
  }
  const tracking = trackingText(graph, bookmark)
  const { commit } = bookmark
  const local = commit?.localBookmarks.find((b) => b.name === bookmark.name)
  const more = bookmark.others.length > 0 ? ` +${bookmark.others.length}` : ''
  return {
    id: 'bookmark',
    side: 'left',
    icon: 'git-branch',
    code: `${bookmark.name}${more}`,
    text: tracking.text,
    tooltip: joinLines([
      tracking.tooltip,
      bookmark.others.length > 0 ? `Also: ${bookmark.others.join(', ')}` : '',
      commit ? 'Click for bookmark actions' : 'Its change is outside the graph',
    ]),
    tone: tracking.tone,
    action: commit
      ? {
          kind: 'bookmarkMenu',
          context: {
            webviewSection: 'ukemi.bookmark',
            repoId: graph.repoId,
            commitId: commit.commitId,
            bookmark: bookmark.name,
            isSynced: local?.synced ?? true,
            isTrunk: commit.isTrunk,
            hasForge: graph.forge !== null,
          },
        }
      : null,
  }
}

function conflictItem(graph: GraphState, workingCopy: CommitView): StatusItem | null {
  const files = graph.workingCopyFiles.filter((file) => file.isConflicted).length
  const conflicted = graph.commits.filter((c) => c.hasConflict)
  const divergent = graph.commits.filter((c) => c.isDivergent).length
  if (files === 0 && conflicted.length === 0 && divergent === 0) {
    return null
  }
  // The oldest conflicted change, last in the graph, is where the conflict came in. Resolving it
  // there fixes the changes above it too, while @ may only have inherited it.
  const target = conflicted.at(-1) ?? (files > 0 ? workingCopy : null)
  const parts = [
    files > 0 ? plural(files, 'conflicted file') : '',
    conflicted.length > 0 ? plural(conflicted.length, 'conflicted change') : '',
    divergent > 0 ? `${divergent} divergent` : '',
  ]
  return {
    id: 'conflicts',
    side: 'left',
    icon: 'warning',
    text: parts.filter(Boolean).join(', '),
    tooltip: target ? 'Click to resolve the conflict' : 'Divergent changes in the graph',
    tone: 'warning',
    action: target ? { kind: 'resolve', commitId: target.commitId } : null,
  }
}

function requestItem(graph: GraphState, bookmark: StatusBookmark | null): StatusItem | null {
  const request = bookmark?.commit?.requests[0]
  if (!request) {
    return null
  }
  const refreshError = graph.forge?.refreshError
  return {
    id: 'request',
    side: 'right',
    icon: CI_ICONS[request.ci],
    isSpinning: request.ci === 'pending',
    text: `#${request.number} ${request.state}`,
    tooltip: joinLines([
      request.title,
      `${request.headBranch} → ${request.baseBranch}, CI ${request.ci}`,
      refreshError ? staleRequestsNote(refreshError) : '',
      'Click to open it in the browser',
    ]),
    tone: request.ci === 'failure' || refreshError ? 'warning' : 'normal',
    action: { kind: 'openUrl', url: request.url },
  }
}

function syncText(state: ViewState, now: number): string {
  if (state.busy) {
    return `${state.busy}…`
  }
  if (state.autoFetch.isRunning) {
    return 'Fetching…'
  }
  const last = state.autoFetch.lastFetch
  if (last === null) {
    return 'Fetch'
  }
  const ago = relativeTime(new Date(last).toISOString(), now)
  if (ago === 'now') {
    return 'Fetched just now'
  }
  // Past a month, relativeTime gives a date rather than an age.
  return /^\d+[mhd]$/.test(ago) ? `Fetched ${ago} ago` : `Fetched ${ago}`
}

function syncItem(state: ViewState, graph: GraphState, now: number): StatusItem {
  const { enabled, interval } = state.autoFetch
  const operation = graph.operationId?.slice(0, SHORT_HASH_LENGTH)
  return {
    id: 'sync',
    side: 'right',
    icon: enabled ? 'sync' : 'sync-ignored',
    isSpinning: state.busy !== null || state.autoFetch.isRunning,
    text: syncText(state, now),
    tooltip: joinLines([
      enabled ? `Auto fetch every ${interval}` : 'Auto fetch off',
      operation ? `Operation ${operation}` : '',
      'Click to fetch',
    ]),
    tone: 'normal',
    action: { kind: 'command', command: 'ukemi.fetch' },
  }
}

function errorItem(error: string): StatusItem {
  return {
    id: 'error',
    side: 'right',
    icon: 'error',
    text: error.split('\n')[0] ?? error,
    tooltip: `${error}\nClick to open the log`,
    tone: 'error',
    action: { kind: 'showLog' },
  }
}

// What the desktop status bar shows for the active repository, left group first.
export function summarizeStatus(state: ViewState, now: number): StatusItem[] {
  const graph = state.graph
  const workingCopy = graph?.commits.find((c) => c.isWorkingCopy)
  if (!graph || !workingCopy) {
    return state.error ? [errorItem(state.error)] : []
  }
  const bookmark = statusBookmark(graph, workingCopy)
  const items = [
    changeItem(workingCopy, state.settings.changeIdLength),
    bookmarkItem(graph, bookmark),
    conflictItem(graph, workingCopy),
    state.error ? errorItem(state.error) : null,
    requestItem(graph, bookmark),
    syncItem(state, graph, now),
  ]
  return items.filter((item): item is StatusItem => item !== null)
}
