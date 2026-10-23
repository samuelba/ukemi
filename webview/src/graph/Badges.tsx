import type { DragEvent } from 'react'
import type { CommitView, RequestBadge } from '../../../shared/protocol'
import { vscodeContext } from '../shared/vscodeApi'

export const BOOKMARK_MIME = 'application/x-ukemi-bookmark'

const REQUEST_LABEL: Record<RequestBadge['state'], string> = {
  draft: 'Draft',
  open: 'Open',
  reviewed: 'Reviewed',
  approved: 'Approved',
  merged: 'Merged',
  closed: 'Closed',
}

const CI_ICON: Record<RequestBadge['ci'], string | null> = {
  success: 'codicon-pass-filled',
  failure: 'codicon-error',
  pending: 'codicon-clock',
  none: null,
}

interface BadgesProps {
  commit: CommitView
  repoId: string
  hasForge: boolean
}

function onBookmarkDrag(name: string) {
  return (event: DragEvent) => {
    event.stopPropagation()
    event.dataTransfer.setData(BOOKMARK_MIME, name)
    event.dataTransfer.effectAllowed = 'move'
  }
}

export function Badges({ commit, repoId, hasForge }: BadgesProps) {
  const localNames = new Set(commit.localBookmarks.map((b) => b.name))
  const remoteOnly = commit.remoteBookmarks.filter((b) => !localNames.has(b.name))
  const showWorkspaces =
    commit.workingCopies.length > 0 && !(commit.isWorkingCopy && commit.workingCopies.length === 1)

  return (
    <span className="badges">
      {commit.isWorkingCopy && <span className="badge here">you are here</span>}
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
      {commit.tags.map((tag) => (
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
      {commit.requests.map((r) => {
        const ci = CI_ICON[r.ci]
        return (
          <span
            key={`pr-${r.number}`}
            className={`badge request request-${r.state}`}
            title={`#${r.number} ${r.title} (${REQUEST_LABEL[r.state]}${r.ci === 'none' ? '' : `, CI ${r.ci}`})`}
            data-vscode-context={vscodeContext({
              webviewSection: 'request',
              repoId,
              commitId: commit.commitId,
              number: r.number,
              isOpen: r.state !== 'merged' && r.state !== 'closed',
              isMerged: r.state === 'merged',
            })}
          >
            <i className="codicon codicon-git-pull-request" />#{r.number}
            <span className="request-state">{REQUEST_LABEL[r.state]}</span>
            {ci && <i className={`codicon ${ci} ci-${r.ci}`} />}
          </span>
        )
      })}
      {commit.hasConflict && <span className="badge conflict">conflict</span>}
      {commit.isDivergent && <span className="badge divergent">divergent</span>}
      {commit.isHidden && <span className="badge hidden">hidden</span>}
    </span>
  )
}
