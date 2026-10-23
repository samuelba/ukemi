import { useState, type DragEvent } from 'react'
import type { ChangedFile } from '../../../shared/model'
import type { CommitView, ViewSettings } from '../../../shared/protocol'
import { relativeTime, splitId, title } from '../shared/format'
import { postMessage, vscodeContext } from '../shared/vscodeApi'
import { BOOKMARK_MIME, Badges } from './Badges'
import { FileList, FILE_MIME } from './FileList'
import { GraphCell } from './GraphCell'

export const COMMIT_MIME = 'application/x-ukemi-commit'

interface CommitRowProps {
  commit: CommitView
  repoId: string
  lanes: number
  files: ChangedFile[] | undefined
  isExpanded: boolean
  isSelected: boolean
  hasRemotes: boolean
  hasForge: boolean
  settings: ViewSettings
  now: number
  onToggle: (commit: CommitView) => void
  onSelect: (commitId: string) => void
  onDescribe: (commit: CommitView) => void
}

type DropKind = 'commit' | 'file' | 'bookmark'

function dropKind(event: DragEvent): DropKind | null {
  const types = event.dataTransfer.types
  if (types.includes(COMMIT_MIME)) {
    return 'commit'
  }
  if (types.includes(FILE_MIME)) {
    return 'file'
  }
  return types.includes(BOOKMARK_MIME) ? 'bookmark' : null
}

function runCommand(command: string, repoId: string, commitId: string) {
  postMessage({ type: 'command', command, context: { repoId, commitId } })
}

export function CommitRow(props: CommitRowProps) {
  const { commit, repoId, settings, isExpanded } = props
  const [dropTarget, setDropTarget] = useState<DropKind | null>(null)
  const change = splitId(commit.changeId, commit.changePrefix, settings.changeIdLength)
  const summary = title(commit.description)
  const fileCount = commit.isWorkingCopy ? (props.files?.length ?? 0) : null
  const canExpand = !commit.isWorkingCopy || (props.files?.length ?? 0) > 0
  const placeholder = commit.isEmpty ? (commit.isWorkingCopy ? '' : '(empty)') : '(no description)'

  const accepts = (kind: DropKind) => {
    if (kind === 'bookmark') {
      return true
    }
    return !commit.isImmutable || kind === 'commit'
  }

  const onDragOver = (event: DragEvent) => {
    const kind = dropKind(event)
    if (kind && accepts(kind)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDropTarget(kind)
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDropTarget(null)
    const kind = dropKind(event)
    if (kind === 'commit') {
      const sourceId = event.dataTransfer.getData(COMMIT_MIME)
      postMessage({
        type: 'dropCommit',
        sourceId,
        targetId: commit.commitId,
        mode: event.altKey ? 'revision' : 'source',
      })
    } else if (kind === 'file') {
      const data = JSON.parse(event.dataTransfer.getData(FILE_MIME)) as {
        commitId: string
        path: string
      }
      postMessage({
        type: 'dropFile',
        fromCommitId: data.commitId,
        path: data.path,
        targetId: commit.commitId,
      })
    } else if (kind === 'bookmark') {
      postMessage({
        type: 'dropBookmark',
        name: event.dataTransfer.getData(BOOKMARK_MIME),
        targetId: commit.commitId,
      })
    }
  }

  const classes = [
    'commit',
    commit.isWorkingCopy && 'is-wc',
    commit.isImmutable && 'is-immutable',
    !commit.isMine && 'is-other',
    props.isSelected && 'is-selected',
    dropTarget && `drop-${dropTarget}`,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={classes}
      draggable={!commit.isImmutable}
      onDragStart={(event) => {
        event.dataTransfer.setData(COMMIT_MIME, commit.commitId)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={onDragOver}
      onDragLeave={() => setDropTarget(null)}
      onDrop={onDrop}
      onClick={() => {
        props.onSelect(commit.commitId)
        if (canExpand) {
          props.onToggle(commit)
        }
      }}
      onDoubleClick={() => postMessage({ type: 'doubleClickCommit', commitId: commit.commitId })}
      data-vscode-context={vscodeContext({
        webviewSection: 'commit',
        repoId,
        commitId: commit.commitId,
        isWorkingCopy: commit.isWorkingCopy,
        isImmutable: commit.isImmutable,
        isEmpty: commit.isEmpty,
        isTrunk: commit.isTrunk,
        hasRemotes: props.hasRemotes,
        hasForge: props.hasForge,
        hasRequest: commit.requests.length > 0,
      })}
    >
      <GraphCell commit={commit} lanes={props.lanes} />
      <div className="commit-body">
        <div className="commit-head">
          <span
            className={`change-id${commit.isDivergent ? ' divergent' : ''}`}
            title={commit.changeId}
          >
            <span className="id-prefix">{change.prefix}</span>
            <span className="id-rest">{change.rest}</span>
            {commit.changeOffset !== null && (
              <span className="id-offset">/{commit.changeOffset}</span>
            )}
          </span>
          <Badges commit={commit} repoId={repoId} hasForge={props.hasForge} />
          <span
            className={`summary${summary ? '' : ' muted'}`}
            title={commit.description || undefined}
          >
            {summary || placeholder}
          </span>
          {fileCount !== null && fileCount > 0 && <span className="file-count">{fileCount}</span>}
          <span className="time" title={`${commit.author.name} · ${commit.committer.timestamp}`}>
            {relativeTime(commit.committer.timestamp, props.now)}
          </span>
          <span className="actions">
            {!commit.isWorkingCopy && !commit.isImmutable && (
              <button
                className="icon-button"
                title="Edit this change"
                onClick={(e) => {
                  e.stopPropagation()
                  runCommand('ukemi.commit.edit', repoId, commit.commitId)
                }}
              >
                <i className="codicon codicon-edit" />
              </button>
            )}
            {!commit.isImmutable && (
              <button
                className="icon-button"
                title="Describe"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onDescribe(commit)
                }}
              >
                <i className="codicon codicon-comment-discussion-quote" />
              </button>
            )}
            <button
              className="icon-button"
              title="New change on top"
              onClick={(e) => {
                e.stopPropagation()
                runCommand('ukemi.commit.new', repoId, commit.commitId)
              }}
            >
              <i className="codicon codicon-add" />
            </button>
          </span>
        </div>
        {isExpanded && canExpand && (
          <FileList
            commit={commit}
            files={props.files}
            repoId={repoId}
            showFullPaths={settings.showFullPaths}
            changedFilesView={settings.changedFilesView}
          />
        )}
      </div>
    </div>
  )
}
