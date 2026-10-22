import type { ReactNode } from 'react'
import { DEPTHLESS_FILTERS, type GraphFilter, type HistoryDepth } from '../../../shared/model'
import type { GraphState, RepoSummary } from '../../../shared/protocol'
import { postMessage } from '../shared/vscodeApi'

const FILTERS: ReadonlyArray<{ id: GraphFilter; label: string; hint: string }> = [
  { id: 'recent', label: 'Recent', hint: 'Mutable changes, bookmarks and tags' },
  { id: 'mine', label: 'Mine', hint: 'All your open changes' },
  { id: 'myHistory', label: 'My history', hint: 'Your open changes, and your history in the time range' },
  { id: 'stack', label: 'Stack', hint: 'Changes connected to the working copy' },
]

const DEPTHS: ReadonlyArray<{ id: HistoryDepth; label: string }> = [
  { id: '7d', label: '7 days' },
  { id: '14d', label: '14 days' },
  { id: '30d', label: '30 days' },
  { id: '1y', label: '1 year' },
  { id: 'all', label: 'All' },
]

interface ToolbarProps {
  repos: RepoSummary[]
  activeRepoId: string | null
  graph: GraphState | null
  isBusy: boolean
}

function command(name: string, context: Record<string, unknown> = {}) {
  postMessage({ type: 'command', command: name, context })
}

function ToolButton({
  icon,
  label,
  onClick,
  isAccent,
  isDisabled,
}: {
  icon: string | ReactNode
  label: string
  onClick: () => void
  isAccent?: boolean
  isDisabled?: boolean
}) {
  return (
    <button
      className={`icon-button${isAccent ? ' accent' : ''}`}
      title={label}
      aria-label={label}
      disabled={isDisabled}
      onClick={onClick}
    >
      {typeof icon === 'string' ? <i className={`codicon codicon-${icon}`} /> : icon}
    </button>
  )
}

function PushAllIcon() {
  return (
    <svg className="svg-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M4.5 7H11.5A4.5 4.5 0 0 1 11.5 16H4.5A4.5 4.5 0 0 1 4.5 7ZM4.5 9L6.854 11.354A0.5 0.5 0 0 1 6.146 12.061L5 10.914V14A0.5 0.5 0 0 1 4 14V10.914L2.854 12.061A0.5 0.5 0 0 1 2.146 11.354ZM11.5 9L13.854 11.354A0.5 0.5 0 0 1 13.146 12.061L12 10.914V14A0.5 0.5 0 0 1 11 14V10.914L9.854 12.061A0.5 0.5 0 0 1 9.146 11.354ZM4.03 6.507C4.273 4.53 5.958 3 8 3C9.862 3 11.411 4.278 11.857 6H10.811C10.397 4.838 9.303 4 8 4C6.343 4 5.076 4.85 5.076 6.507Z"
      />
    </svg>
  )
}

function pushCurrentLabel(graph: GraphState): string {
  return graph.currentBookmarks.length > 0
    ? `Push ${graph.currentBookmarks.join(', ')}`
    : 'Push current bookmark (no bookmark on this stack)'
}

function hasUnsyncedCurrent(graph: GraphState): boolean {
  const current = new Set(graph.currentBookmarks)
  return graph.commits.some((c) => c.localBookmarks.some((b) => current.has(b.name) && !b.synced))
}

export function Toolbar({ repos, activeRepoId, graph, isBusy }: ToolbarProps) {
  const repoId = graph?.repoId
  const ignoresDepth = graph !== null && DEPTHLESS_FILTERS.includes(graph.filter)
  return (
    <div className="toolbar">
      <div className="toolbar-row">
        {repos.length > 1 ? (
          <select
            className="repo-select"
            value={activeRepoId ?? ''}
            title="Repository"
            onChange={(e) => postMessage({ type: 'selectRepo', repoId: e.target.value })}
          >
            {repos.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.label}
                {repo.kind === 'git'
                  ? ' (git)'
                  : repo.changedFiles > 0
                    ? ` (${repo.changedFiles} changed)`
                    : ''}
              </option>
            ))}
          </select>
        ) : (
          <span className="repo-label" title={activeRepoId ?? undefined}>
            {repos[0]?.label ?? ''}
          </span>
        )}
        <span className="toolbar-spacer" />
        {graph && (
          <>
            <ToolButton
              icon="search"
              label="Go to bookmark, request or revision"
              onClick={() => command('ukemi.goTo', { repoId })}
            />
            {graph.hasRemotes && (
              <>
                <ToolButton
                  icon="cloud-download"
                  label="Fetch"
                  onClick={() => command('ukemi.fetch', { repoId })}
                />
                <ToolButton
                  icon="cloud-upload"
                  label={pushCurrentLabel(graph)}
                  isAccent={hasUnsyncedCurrent(graph)}
                  isDisabled={graph.currentBookmarks.length === 0}
                  onClick={() => command('ukemi.pushCurrent', { repoId })}
                />
                <ToolButton
                  icon={<PushAllIcon />}
                  label={
                    graph.hasUnpushed
                      ? 'Push all tracked bookmarks (unpushed changes)'
                      : 'Push all tracked bookmarks'
                  }
                  isAccent={graph.hasUnpushed}
                  onClick={() => command('ukemi.push', { repoId })}
                />
              </>
            )}
            <ToolButton
              icon="discard"
              label="Undo last operation"
              onClick={() => command('ukemi.undo', { repoId })}
            />
            <ToolButton
              icon="redo"
              label={graph.canRedo ? 'Redo' : 'Nothing to redo'}
              isDisabled={!graph.canRedo}
              onClick={() => command('ukemi.redo', { repoId })}
            />
          </>
        )}
        <ToolButton
          icon={isBusy ? 'refresh codicon-modifier-spin' : 'refresh'}
          label="Refresh"
          onClick={() => command('ukemi.refresh')}
        />
      </div>
      {graph && (
        <div className="toolbar-row filters">
          <div className="segmented" role="tablist">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={graph.filter === f.id}
                className={graph.filter === f.id ? 'active' : ''}
                title={f.hint}
                onClick={() => postMessage({ type: 'setFilter', filter: f.id })}
              >
                {f.label}
              </button>
            ))}
          </div>
          <span className="toolbar-spacer" />
          <select
            className="depth-select"
            value={graph.depth}
            title={ignoresDepth ? 'Stack shows the whole stack, whatever its age' : 'History depth'}
            disabled={ignoresDepth}
            onChange={(e) =>
              postMessage({ type: 'setDepth', depth: e.target.value as HistoryDepth })
            }
          >
            {DEPTHS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
