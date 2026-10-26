import { useEffect, useState, useSyncExternalStore, type DragEvent } from 'react'
import { parseFileDrag } from '../../../shared/fileUri'
import type { ChangedFile } from '../../../shared/model'
import type { CommitView, ViewSettings } from '../../../shared/protocol'
import { relativeTime, splitId, title } from '../shared/format'
import { postMessage, vscodeContext } from '../shared/vscodeApi'
import { BOOKMARK_MIME, Badges, RequestRow } from './Badges'
import { canSquashIntoParent } from './canSquashIntoParent'
import { dropCommitAction, fileDropAction } from './dropCommit'
import { dragModifiers, installDragModifiers } from './dragModifiers'
import { FileList, FILE_LOCKED_MIME, FILE_MIME } from './FileList'
import { LineStats, lineTotals } from './LineStats'
import { GraphCell } from './GraphCell'

export const COMMIT_MIME = 'application/x-ukemi-commit'

interface CommitRowProps {
  commit: CommitView
  commitsById: ReadonlyMap<string, CommitView>
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

type DropKind = 'commit' | 'duplicate' | 'file' | 'bookmark'

function useCopyModifier() {
  useEffect(() => installDragModifiers(), [])
  return useSyncExternalStore(
    dragModifiers.subscribe,
    () => dragModifiers.copyDown,
    () => false,
  )
}

function dropKind(event: DragEvent, copy: boolean): DropKind | null {
  const types = event.dataTransfer.types
  if (types.includes(COMMIT_MIME)) {
    return 'commit'
  }
  if (types.includes(FILE_MIME)) {
    if (types.includes(FILE_LOCKED_MIME) && !copy) {
      return null
    }
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
  const copyModifier = useCopyModifier()
  const change = splitId(commit.changeId, commit.changePrefix, settings.changeIdLength)
  const summary = title(commit.description)
  const fileCount = commit.isWorkingCopy ? (props.files?.length ?? 0) : null
  const totals =
    commit.isWorkingCopy && settings.showLineStats ? lineTotals(props.files ?? []) : null
  const canExpand = !commit.isWorkingCopy || (props.files?.length ?? 0) > 0
  const placeholder = commit.isEmpty ? (commit.isWorkingCopy ? '' : '(empty)') : '(no description)'

  const accepts = (kind: DropKind) => {
    if (kind === 'bookmark') {
      return true
    }
    return !commit.isImmutable || kind === 'commit'
  }

  const onDragOver = (event: DragEvent) => {
    dragModifiers.onDragOver(event)
    const copy = dragModifiers.snapshot().copy
    const kind = dropKind(event, copy)
    if (kind && accepts(kind)) {
      event.preventDefault()
      const copyDrop = (kind === 'commit' || kind === 'file') && copy
      event.dataTransfer.dropEffect = copyDrop ? 'copy' : 'move'
      setDropTarget(copyDrop ? 'duplicate' : kind)
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDropTarget(null)
    dragModifiers.onDragOver(event)
    const modifiers = dragModifiers.snapshot()
    const kind = dropKind(event, modifiers.copy)
    if (kind === 'commit') {
      const { action, mode } = dropCommitAction(modifiers.copy, modifiers.alt)
      postMessage({
        type: 'dropCommit',
        sourceId: event.dataTransfer.getData(COMMIT_MIME),
        targetId: commit.commitId,
        action,
        mode,
      })
    } else if (kind === 'file') {
      const data = parseFileDrag(event.dataTransfer.getData(FILE_MIME))
      if (!data) {
        return
      }
      const action = fileDropAction(modifiers.copy, data.isImmutable)
      if (!action) {
        return
      }
      postMessage({
        type: 'dropFile',
        fromCommitId: data.commitId,
        path: data.path,
        targetId: commit.commitId,
        action,
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
      data-commit-id={commit.commitId}
      draggable={!commit.isImmutable || copyModifier}
      onDragStart={(event) => {
        const copy =
          event.ctrlKey || event.metaKey || dragModifiers.snapshot().copy
        if (commit.isImmutable && !copy) {
          event.preventDefault()
          return
        }
        dragModifiers.onDragStart(event, commit.isImmutable)
        event.dataTransfer.setData(COMMIT_MIME, commit.commitId)
        event.dataTransfer.effectAllowed = 'copyMove'
      }}
      onDragEnd={() => dragModifiers.onDragEnd()}
      onDragOver={onDragOver}
      onDragLeave={() => setDropTarget(null)}
      onDrop={onDrop}
      onClick={() => {
        props.onSelect(commit.commitId)
        if (canExpand) {
          props.onToggle(commit)
        }
      }}
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
          <Badges
            commit={commit}
            repoId={repoId}
            hasForge={props.hasForge}
            ciOnlyMine={settings.ciOnlyMine}
            showGitTags={settings.showGitTags}
          />
          <span
            className={`summary${summary ? '' : ' muted'}`}
            title={commit.description || undefined}
          >
            {summary || placeholder}
          </span>
          {fileCount !== null && fileCount > 0 && <span className="file-count">{fileCount}</span>}
          {totals && <LineStats added={totals.added} removed={totals.removed} />}
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
            {canSquashIntoParent(commit, props.commitsById) && (
              <button
                className="icon-button"
                title="Squash into parent"
                onClick={(e) => {
                  e.stopPropagation()
                  runCommand('ukemi.commit.squash', repoId, commit.commitId)
                }}
              >
                <i className="codicon codicon-fold-down" />
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
        <RequestRow
          commit={commit}
          repoId={repoId}
          hasForge={props.hasForge}
          ciOnlyMine={settings.ciOnlyMine}
          showGitTags={settings.showGitTags}
        />
        {isExpanded && canExpand && (
          <FileList
            commit={commit}
            files={props.files}
            repoId={repoId}
            showFullPaths={settings.showFullPaths}
            showLineStats={settings.showLineStats}
            changedFilesView={settings.changedFilesView}
          />
        )}
      </div>
    </div>
  )
}
