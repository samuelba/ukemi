import type { RepoSummary, ViewStatus } from '../../../shared/protocol'
import { LoadingMark } from '../shared/LoadingMark'
import { postMessage } from '../shared/vscodeApi'

interface EmptyStateProps {
  status: ViewStatus
  repos: RepoSummary[]
  activeRepoId: string | null
  error: string | null
  busy: string | null
}

function Panel({
  heading,
  spinning,
  children,
}: {
  heading: string
  spinning: boolean
  children: React.ReactNode
}) {
  return (
    <div className="empty">
      <LoadingMark spinning={spinning} />
      <div className="empty-heading">{heading}</div>
      {children}
    </div>
  )
}

export function EmptyState({ status, repos, activeRepoId, error, busy }: EmptyStateProps) {
  const spinning = status === 'loading' || busy !== null
  switch (status) {
    case 'loading':
      return (
        <Panel heading="Loading…" spinning={spinning}>
          <p className="muted">Reading the repository.</p>
        </Panel>
      )
    case 'no-jj':
      return (
        <Panel heading="Jujutsu (jj) not found" spinning={spinning}>
          <p>
            Ukemi needs the jj command. Install the official release, or set the path in the
            settings.
          </p>
          <button className="button" onClick={() => postMessage({ type: 'installJj' })}>
            Download jj
          </button>
          <button
            className="button secondary"
            onClick={() =>
              postMessage({ type: 'command', command: 'ukemi.openSettings', context: {} })
            }
          >
            Set jj path
          </button>
        </Panel>
      )
    case 'no-folder':
      return (
        <Panel heading="No folder open" spinning={spinning}>
          <p>Open a folder that contains a jj or Git repository.</p>
          <button className="button" onClick={() => postMessage({ type: 'openFolder' })}>
            Open folder
          </button>
        </Panel>
      )
    case 'no-repo': {
      const gitRepos = repos.filter((r) => r.kind === 'git')
      const selected = gitRepos.find((r) => r.id === activeRepoId)
      const candidates = selected ? [selected] : gitRepos
      return (
        <Panel
          heading={candidates.length > 0 ? 'Git repository found' : 'No repository found'}
          spinning={spinning}
        >
          {candidates.length > 0 ? (
            <>
              <p>Initialize jj next to Git. Git keeps working as before.</p>
              {candidates.map((repo) => (
                <button
                  key={repo.id}
                  className="button"
                  onClick={() => postMessage({ type: 'initRepo', root: repo.id })}
                >
                  Initialize jj in {repo.label}
                </button>
              ))}
            </>
          ) : (
            <>
              <p>No jj or Git repository in this workspace.</p>
              <button
                className="button"
                onClick={() =>
                  postMessage({ type: 'command', command: 'ukemi.initRepo', context: {} })
                }
              >
                Initialize repository…
              </button>
            </>
          )}
        </Panel>
      )
    }
    case 'error':
      return (
        <Panel heading="Could not read the repository" spinning={spinning}>
          <p className="error-text">{error}</p>
          <button
            className="button"
            onClick={() => postMessage({ type: 'command', command: 'ukemi.refresh', context: {} })}
          >
            Retry
          </button>
        </Panel>
      )
    case 'ready':
      return null
  }
}
