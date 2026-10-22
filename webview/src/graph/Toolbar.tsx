import type { GraphFilter, HistoryDepth } from '../../../shared/model'
import type { GraphState, RepoSummary } from '../../../shared/protocol'
import { postMessage } from '../shared/vscodeApi'

const FILTERS: ReadonlyArray<{ id: GraphFilter; label: string; hint: string }> = [
  { id: 'recent', label: 'Recent', hint: 'Mutable changes, bookmarks and tags' },
  { id: 'mine', label: 'Mine', hint: 'Only your mutable changes' },
  { id: 'stack', label: 'Stack', hint: 'Changes connected to the working copy' },
]

const DEPTHS: ReadonlyArray<{ id: HistoryDepth; label: string }> = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '1y', label: '1 year' },
  { id: 'all', label: 'All' },
]

interface ToolbarProps {
  repos: RepoSummary[]
  activeRepoId: string | null
  graph: GraphState | null
}

function command(name: string, context: Record<string, unknown> = {}) {
  postMessage({ type: 'command', command: name, context })
}

function ToolButton({
  icon,
  label,
  onClick,
  isAccent,
}: {
  icon: string
  label: string
  onClick: () => void
  isAccent?: boolean
}) {
  return (
    <button
      className={`icon-button${isAccent ? ' accent' : ''}`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <i className={`codicon codicon-${icon}`} />
    </button>
  )
}

export function Toolbar({ repos, activeRepoId, graph }: ToolbarProps) {
  const repoId = graph?.repoId
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
                  label={
                    graph.hasUnpushed
                      ? 'Push tracked bookmarks (unpushed changes)'
                      : 'Push tracked bookmarks'
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
              label="Redo"
              onClick={() => command('ukemi.redo', { repoId })}
            />
          </>
        )}
        <ToolButton icon="refresh" label="Refresh" onClick={() => command('ukemi.refresh')} />
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
            title="History depth"
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
