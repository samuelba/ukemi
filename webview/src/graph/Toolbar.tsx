import type { GraphFilter, HistoryDepth } from '../../../shared/model'
import type { GraphState, RepoSummary } from '../../../shared/protocol'
import { postMessage } from '../shared/vscodeApi'

const FILTERS: ReadonlyArray<{ id: GraphFilter; label: string; hint: string }> = [
  { id: 'recent', label: 'Recent', hint: 'Mutable changes, bookmarks and tags' },
  { id: 'mine', label: 'Mine', hint: 'All your open changes, and your history in the time range' },
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
  icon: string
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
      <i className={`codicon codicon-${icon}`} />
    </button>
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
  const ignoresDepth = graph?.filter === 'stack'
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
                  icon="repo-push"
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
