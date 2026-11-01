import type { DesktopRendererMessage } from '../../../shared/desktopProtocol'
import type { RepoSummary } from '../../../shared/protocol'
import { postMessage } from '../shared/hostApi'

function send(message: DesktopRendererMessage | { type: 'selectRepo'; repoId: string }): void {
  postMessage(message)
}

// The open repositories of the window, one tab each.
export function RepoTabs({
  repos,
  activeRepoId,
}: {
  repos: readonly RepoSummary[]
  activeRepoId: string | null
}) {
  return (
    <nav className="repo-tabs" aria-label="Open repositories">
      <div className="repo-tabs-list" role="tablist">
        {repos.map((repo) => {
          const isActive = repo.id === activeRepoId
          return (
            <div
              key={repo.id}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              title={repo.id}
              className={`repo-tab${isActive ? ' is-active' : ''}`}
              onClick={() => !isActive && send({ type: 'selectRepo', repoId: repo.id })}
              onAuxClick={(e) =>
                e.button === 1 && send({ type: 'desktop.closeRepo', repoId: repo.id })
              }
            >
              <span
                className={`codicon codicon-${repo.kind === 'git' ? 'git-branch' : 'repo'}`}
                aria-hidden
              />
              <span className="repo-tab-label">{repo.label}</span>
              {repo.changedFiles > 0 && (
                <span className="repo-tab-count" title={`${repo.changedFiles} changed files in @`}>
                  {repo.changedFiles}
                </span>
              )}
              <button
                className="repo-tab-close"
                aria-label={`Close ${repo.label}`}
                onClick={(e) => {
                  e.stopPropagation()
                  send({ type: 'desktop.closeRepo', repoId: repo.id })
                }}
              >
                <span className="codicon codicon-close" aria-hidden />
              </button>
            </div>
          )
        })}
      </div>
      <button
        className="icon-button"
        title="Open repository (Ctrl+O)"
        aria-label="Open repository"
        onClick={() => send({ type: 'desktop.openRepo' })}
      >
        <span className="codicon codicon-add" aria-hidden />
      </button>
    </nav>
  )
}
