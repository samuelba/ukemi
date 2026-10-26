import type { DragEvent } from 'react'
import type { CommitView, RequestBadge } from '../../../shared/protocol'
import { postMessage, vscodeContext } from '../shared/vscodeApi'
import { RequestHover } from './RequestHover'
import { CiStatusIcon, REQUEST_LABEL } from './requestMeta'

export const BOOKMARK_MIME = 'application/x-ukemi-bookmark'

function openExternal(url: string): void {
  postMessage({ type: 'openUrl', url })
}

function HereIcon() {
  return (
    <svg className="svg-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10.833 2.688 C10.086 1.941 9.077 1.514 8.02 1.5 L7.98 1.5 C6.924 1.514 5.915 1.941 5.168 2.688 C4.421 3.435 3.995 4.444 3.98 5.5 C3.967 6.25 4.178 6.987 4.586 7.617 L7.734 14 L8.267 14 L11.414 7.617 C11.823 6.987 12.034 6.25 12.02 5.5 C12.006 4.444 11.58 3.435 10.833 2.688 Z M8.536 4.669 C8.371 4.559 8.178 4.5 7.98 4.5 C7.715 4.5 7.461 4.605 7.273 4.793 C7.086 4.98 6.98 5.235 6.98 5.5 C6.98 5.698 7.039 5.891 7.149 6.056 C7.259 6.22 7.415 6.348 7.598 6.424 C7.78 6.5 7.981 6.519 8.175 6.481 C8.369 6.442 8.547 6.347 8.687 6.207 C8.827 6.067 8.922 5.889 8.961 5.695 C9 5.501 8.98 5.3 8.904 5.117 C8.828 4.935 8.7 4.778 8.536 4.669 Z"
      />
    </svg>
  )
}

function showCi(request: RequestBadge, ciOnlyMine: boolean): boolean {
  const isOpen = request.state !== 'merged' && request.state !== 'closed'
  return isOpen && (!ciOnlyMine || request.isMine)
}

interface BadgesProps {
  commit: CommitView
  repoId: string
  hasForge: boolean
  ciOnlyMine: boolean
  showGitTags: boolean
}

function onBookmarkDrag(name: string) {
  return (event: DragEvent) => {
    event.stopPropagation()
    event.dataTransfer.setData(BOOKMARK_MIME, name)
    event.dataTransfer.effectAllowed = 'move'
  }
}

export function Badges({ commit, repoId, hasForge, showGitTags }: BadgesProps) {
  const localNames = new Set(commit.localBookmarks.map((b) => b.name))
  const remoteOnly = commit.remoteBookmarks.filter((b) => !localNames.has(b.name))
  const showWorkspaces =
    commit.workingCopies.length > 0 && !(commit.isWorkingCopy && commit.workingCopies.length === 1)

  return (
    <span className="badges">
      {commit.isWorkingCopy && (
        <span className="badge here" title="you are here">
          <HereIcon />
        </span>
      )}
      {commit.isWorkingCopy && commit.isEmpty && (
        <span className="badge is-empty" title="No file changes yet">empty</span>
      )}
      {commit.localBookmarks.map((b) => (
        <span
          key={`l-${b.name}`}
          className={`badge bookmark${b.synced ? '' : ' unsynced'}${b.conflict ? ' conflict' : ''}`}
          title={
            b.conflict ? `${b.name} (conflicted)` : b.synced ? b.name : `${b.name} (not pushed)`
          }
          draggable
          onDragStart={onBookmarkDrag(b.name)}
          data-vscode-context={vscodeContext({
            webviewSection: 'bookmark',
            repoId,
            commitId: commit.commitId,
            bookmark: b.name,
            isSynced: b.synced,
            isTrunk: commit.isTrunk,
            hasForge,
          })}
        >
          <i className="codicon codicon-bookmark" />
          {b.name}
          {b.conflict ? '??' : b.synced ? '' : '*'}
        </span>
      ))}
      {remoteOnly.map((b) => (
        <span
          key={`r-${b.name}@${b.remote}`}
          className="badge bookmark remote"
          title={`${b.name}@${b.remote}${b.tracked ? '' : ' (not tracked)'}`}
          data-vscode-context={vscodeContext({
            webviewSection: 'bookmark',
            repoId,
            commitId: commit.commitId,
            bookmark: b.name,
            remote: b.remote,
            isRemoteOnly: true,
            isTracked: b.tracked,
          })}
        >
          <i className="codicon codicon-cloud" />
          {b.name}@{b.remote}
        </span>
      ))}
      {showGitTags &&
        commit.tags.map((tag) => (
          <span key={`t-${tag}`} className="badge tag" title={`tag ${tag}`}>
            <i className="codicon codicon-tag" />
            {tag}
          </span>
        ))}
      {showWorkspaces &&
        commit.workingCopies.map((name) => (
          <span
            key={`w-${name}`}
            className="badge workspace"
            title={`workspace ${name}`}
            data-vscode-context={vscodeContext({
              webviewSection: 'workspace',
              repoId,
              workspace: name,
              isDefault: name === 'default',
            })}
          >
            <i className="codicon codicon-folder" />
            {name}@
          </span>
        ))}
      {commit.hasConflict && <span className="badge conflict">conflict</span>}
      {commit.isDivergent && <span className="badge divergent">divergent</span>}
      {commit.isHidden && <span className="badge hidden">hidden</span>}
    </span>
  )
}

export function RequestRow({ commit, repoId, ciOnlyMine }: BadgesProps) {
  if (commit.requests.length === 0) {
    return null
  }
  return (
    <div className="request-row">
      {commit.requests.map((request) => (
        <RequestBadge
          key={`pr-${request.number}`}
          request={request}
          repoId={repoId}
          commitId={commit.commitId}
          ciOnlyMine={ciOnlyMine}
        />
      ))}
    </div>
  )
}

function RequestBadge({
  request,
  repoId,
  commitId,
  ciOnlyMine,
}: {
  request: RequestBadge
  repoId: string
  commitId: string
  ciOnlyMine: boolean
}) {
  const details = showCi(request, ciOnlyMine)
  const badge = (
    <span
      className={`badge request request-${request.state}`}
      title={
        details ? undefined : `#${request.number} ${request.title} (${REQUEST_LABEL[request.state]})`
      }
      data-vscode-context={vscodeContext({
        webviewSection: 'request',
        repoId,
        commitId,
        number: request.number,
        isOpen: request.state !== 'merged' && request.state !== 'closed',
        isMerged: request.state === 'merged',
      })}
    >
      <i className="codicon codicon-git-pull-request" />#{request.number}
      <span className="request-state">{REQUEST_LABEL[request.state]}</span>
      {details && <CiStatusIcon state={request.ci} />}
      <button
        type="button"
        className="request-link"
        title="Open in browser"
        onClick={(event) => {
          event.stopPropagation()
          openExternal(request.url)
        }}
      >
        <i className="codicon codicon-link-external" />
      </button>
    </span>
  )
  if (!details) {
    return badge
  }
  return <RequestHover request={request}>{badge}</RequestHover>
}
