import type { ReactNode } from 'react'
import { DEPTHLESS_FILTERS, type GraphFilter, type HistoryDepth } from '../../../shared/model'
import type { AutoFetchState, GraphState, RepoSummary } from '../../../shared/protocol'
import { settingsCommandHref } from '../../../shared/settingsLink'
import { postMessage } from '../shared/vscodeApi'

const FILTERS: ReadonlyArray<{ id: GraphFilter; label: string; hint: string }> = [
  { id: 'recent', label: 'Recent', hint: 'Mutable changes, bookmarks and tags' },
  { id: 'mine', label: 'Mine', hint: 'All your open changes' },
  {
    id: 'myHistory',
    label: 'My history',
    hint: 'Your open changes, and your history in the time range',
  },
  { id: 'stack', label: 'Stack', hint: 'Changes connected to the working copy' },
  { id: 'working', label: 'Working copy', hint: 'The working copy and its last 5 parents' },
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
  autoFetch: AutoFetchState
  showGitTags: boolean
}

function everyLabel(interval: string): string {
  const text = interval.trim()
  return /^every\s+/i.test(text) ? text : `every ${text}`
}

function fetchLabel(autoFetch: AutoFetchState): string {
  return autoFetch.enabled
    ? `Fetch (auto fetch on, ${everyLabel(autoFetch.interval)})`
    : 'Fetch (auto fetch off)'
}

function autoFetchLabel(autoFetch: AutoFetchState): string {
  return autoFetch.enabled
    ? `Auto fetch on, ${everyLabel(autoFetch.interval)} (click to turn off)`
    : 'Auto fetch off (click to turn on)'
}

function command(name: string, context: Record<string, unknown> = {}) {
  postMessage({ type: 'command', command: name, context })
}

function SettingsGear() {
  if (document.body.dataset.cursor !== '1') {
    return null
  }
  return (
    <a
      className="icon-button"
      href={settingsCommandHref('@ext:samuelba.ukemi-jj')}
      title="Open Settings"
      aria-label="Open Settings"
    >
      <i className="codicon codicon-gear" />
    </a>
  )
}

function ToolButton({
  icon,
  label,
  onClick,
  isAccent,
  isOn,
  isDisabled,
  isPressed,
}: {
  icon: string | ReactNode
  label: string
  onClick: () => void
  isAccent?: boolean
  isOn?: boolean
  isDisabled?: boolean
  isPressed?: boolean
}) {
  return (
    <button
      className={`icon-button${isAccent ? ' accent' : ''}${isOn ? ' on' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={isPressed}
      disabled={isDisabled}
      onClick={onClick}
    >
      {typeof icon === 'string' ? <i className={`codicon codicon-${icon}`} /> : icon}
    </button>
  )
}

/** Carbon “clean” icon. Copyright IBM Corp. Apache-2.0. */
function CleanIcon() {
  return (
    <svg className="svg-icon" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M20 18H26V20H20z" transform="rotate(-180 23 19)" />
      <path d="M24 26H30V28H24z" transform="rotate(-180 27 27)" />
      <path d="M22 22H28V24H22z" transform="rotate(-180 25 23)" />
      <path d="M17.0029,20a4.8952,4.8952,0,0,0-2.4044-4.1729L22,3,20.2691,2,12.6933,15.126A5.6988,5.6988,0,0,0,7.45,16.6289C3.7064,20.24,3.9963,28.6821,4.01,29.04a1,1,0,0,0,1,.96H20.0012a1,1,0,0,0,.6-1.8C17.0615,25.5439,17.0029,20.0537,17.0029,20ZM11.93,16.9971A3.11,3.11,0,0,1,15.0041,20c0,.0381.0019.208.0168.4688L9.1215,17.8452A3.8,3.8,0,0,1,11.93,16.9971ZM15.4494,28A5.2,5.2,0,0,1,14,25H12a6.4993,6.4993,0,0,0,.9684,3H10.7451A16.6166,16.6166,0,0,1,10,24H8a17.3424,17.3424,0,0,0,.6652,4H6c.031-1.8364.29-5.8921,1.8027-8.5527l7.533,3.35A13.0253,13.0253,0,0,0,17.5968,28Z" />
    </svg>
  )
}

function NewChangeIcon() {
  return (
    <span className="icon-with-badge">
      <i className="codicon codicon-git-branch" />
      <i className="codicon codicon-add icon-badge" />
    </span>
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

export function Toolbar({
  repos,
  activeRepoId,
  graph,
  isBusy,
  autoFetch,
  showGitTags,
}: ToolbarProps) {
  const repoId = graph?.repoId
  const ignoresDepth = graph !== null && DEPTHLESS_FILTERS.includes(graph.filter)
  const singleLabel = repos.length === 1 ? (repos[0]?.label ?? '') : ''
  const showRepoRow = repos.length > 1 || singleLabel !== ''
  return (
    <div className="toolbar">
      {showRepoRow && (
        <div className="toolbar-row">
          {repos.length > 1 ? (
            <select
              className="repo-select"
              value={activeRepoId ?? ''}
              title="Repository"
              aria-label="Repository"
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
              {singleLabel}
            </span>
          )}
          <SettingsGear />
        </div>
      )}
      <div className="toolbar-row">
        <span className="toolbar-spacer" />
        {graph && (
          <>
            <ToolButton
              icon="git-branch"
              label={
                graph.trunkName
                  ? `New change from trunk (${graph.trunkName})`
                  : 'New change from trunk'
              }
              onClick={() => command('ukemi.newFromTrunk', { repoId })}
            />
            <ToolButton
              icon={<NewChangeIcon />}
              label="New change from bookmark, request, or revision"
              onClick={() => command('ukemi.goTo', { repoId })}
            />
            {graph.hasRemotes && (
              <>
                <ToolButton
                  icon="cloud-download"
                  label={fetchLabel(autoFetch)}
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
                      ? 'Push all bookmarks (unpushed changes)'
                      : 'Push all bookmarks'
                  }
                  isAccent={graph.hasUnpushed}
                  onClick={() => command('ukemi.push', { repoId })}
                />
              </>
            )}
            <ToolButton
              icon={<CleanIcon />}
              label="Clean up bookmarks, workspaces and divergent changes"
              onClick={() => command('ukemi.cleanup', { repoId })}
            />
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
        {!showRepoRow && <SettingsGear />}
      </div>
      {graph && (
        <div className="toolbar-row filters">
          <select
            className="compact-select"
            value={graph.filter}
            title={FILTERS.find((f) => f.id === graph.filter)?.hint}
            aria-label="Filter"
            onChange={(e) =>
              postMessage({ type: 'setFilter', filter: e.target.value as GraphFilter })
            }
          >
            {FILTERS.map((f) => (
              <option key={f.id} value={f.id} title={f.hint}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            className="compact-select"
            value={graph.depth}
            title={ignoresDepth ? 'This filter ignores the time range' : 'History depth'}
            aria-label="History depth"
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
          <span className="toolbar-spacer" />
          {graph.hasRemotes && (
            <ToolButton
              icon={autoFetch.enabled ? 'sync' : 'sync-ignored'}
              label={autoFetchLabel(autoFetch)}
              isOn={autoFetch.enabled}
              onClick={() => command('ukemi.toggleAutoFetch')}
            />
          )}
          <ToolButton
            icon="tag"
            label={showGitTags ? 'Hide git tags' : 'Show git tags'}
            isOn={showGitTags}
            isPressed={showGitTags}
            onClick={() => command('ukemi.toggleGitTags')}
          />
        </div>
      )}
    </div>
  )
}
