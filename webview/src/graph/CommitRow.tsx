import { memo, useEffect, useId, useSyncExternalStore, type DragEvent } from 'react'
import type { PreviewDrop } from '../../../shared/dropPreview'
import { parseFileDrag } from '../../../shared/fileUri'
import type { ChangedFile } from '../../../shared/model'
import type { CommitView, ViewSettings } from '../../../shared/protocol'
import { splitId, title } from '../shared/format'
import { isDesktop, postMessage, vscodeContext } from '../shared/hostApi'
import { BOOKMARK_MIME, Badges, RequestRow } from './Badges'
import {
  dropCommitAction,
  fileDropAction,
  insertCommitAction,
  insertEdge,
  type InsertEdge,
} from './dropCommit'
import { dragModifiers, installDragModifiers } from './dragModifiers'
import { setTranslucentDragImage } from './dragImage'
import { createDropMarker } from './dropMarker'
import { FileList, FILE_LOCKED_MIME, FILE_MIME } from './FileList'
import { LineStats, lineTotals } from './LineStats'
import { GraphCell } from './GraphCell'
import { RelativeTime } from './RelativeTime'
import { statusWords } from './rowStatus'
import { treeKeyAction } from './treeKeys'

export const COMMIT_MIME = 'application/x-ukemi-commit'

interface CommitRowProps {
  commit: CommitView
  // The neighbouring rows a change can be dropped between this row and (see insertGaps).
  gapAbove: string | null
  gapBelow: string | null
  canSquash: boolean
  repoId: string
  lanes: number
  files: ChangedFile[] | undefined
  isExpanded: boolean
  isSelected: boolean
  // The one row of the tree that Tab reaches (roving tabindex).
  isTabStop: boolean
  // A search is open and this change does not match it.
  isDimmed: boolean
  hasRemotes: boolean
  hasForge: boolean
  // Set when the latest request refresh failed, so the request badges are left from an earlier one.
  requestRefreshError: string | undefined
  settings: ViewSettings
  onToggle: (commit: CommitView) => void
  onSelect: (commitId: string) => void
  onDescribe: (commit: CommitView) => void
  // A change was dropped on this row or next to it. The graph previews or runs it.
  onDropCommit: (drop: PreviewDrop) => void
}

type DropKind = 'commit' | 'duplicate' | 'file' | 'bookmark' | `insert-${InsertEdge}`

// The drag data cannot be read before the drop, so the row being dragged is kept here.
let draggedCommitId: string | null = null

// Shared by all rows, so a row that misses its dragleave cannot keep a stale marker.
const dropMarker = createDropMarker<DropKind>()

// File and bookmark drags start outside a commit row, so clear on any drag that ends.
if (typeof window !== 'undefined') {
  window.addEventListener('dragend', () => dropMarker.clear(), true)
  window.addEventListener('drop', () => dropMarker.clear(), true)
}

function useDropTarget(commitId: string): DropKind | null {
  return useSyncExternalStore(
    dropMarker.subscribe,
    () => dropMarker.kindFor(commitId),
    () => null,
  )
}

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

function pointInside(element: Element, x: number, y: number): boolean {
  const rect = element.getBoundingClientRect()
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
}

function runCommand(command: string, repoId: string, commitId: string) {
  postMessage({ type: 'command', command, context: { repoId, commitId } })
}

// The row selects on click, so an action must not let the click reach it. Out of the tab order:
// the row is the tab stop, and the same commands are in its context menu.
function RowAction({ title, icon, onClick }: { title: string; icon: string; onClick: () => void }) {
  return (
    <button
      className="icon-button"
      title={title}
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      <i className={`codicon codicon-${icon}`} />
    </button>
  )
}

// Memoized: a refresh keeps the objects of unchanged commits (see keepUnchanged), so only the
// rows that changed render again.
export const CommitRow = memo(function CommitRow(props: CommitRowProps) {
  const { commit, repoId, settings, isExpanded } = props
  const dropTarget = useDropTarget(commit.commitId)
  const setDropTarget = (kind: DropKind | null) =>
    kind ? dropMarker.show(commit.commitId, kind) : dropMarker.hide(commit.commitId)
  const copyModifier = useCopyModifier()
  const change = splitId(commit.changeId, commit.changePrefix, settings.changeIdLength)
  const summary = title(commit.description)
  const fileCount = commit.isWorkingCopy ? (props.files?.length ?? 0) : null
  const totals =
    commit.isWorkingCopy && settings.showLineStats ? lineTotals(props.files ?? []) : null
  const canExpand = !commit.isWorkingCopy || (props.files?.length ?? 0) > 0
  const placeholder = commit.isEmpty ? (commit.isWorkingCopy ? '' : '(empty)') : '(no description)'
  // GraphCell is aria-hidden, so the states its node shape shows are said in words.
  const statusText = statusWords(commit).join(', ')
  // Named by its summary, status and change id, so the file rows inside it and the action
  // buttons stay out of the name.
  const nameId = useId()

  const accepts = (kind: DropKind) => {
    if (kind === 'bookmark') {
      return true
    }
    return !commit.isImmutable || kind === 'commit'
  }

  // The pair of changes a drop on the edge of this row goes between, if any.
  const insertPair = (
    event: DragEvent,
  ): { edge: InsertEdge; after: string; before: string } | null => {
    const rect = event.currentTarget.getBoundingClientRect()
    const edge = insertEdge(event.clientY - rect.top, rect.height)
    const pair =
      edge === 'above' && props.gapAbove
        ? { edge, after: commit.commitId, before: props.gapAbove }
        : edge === 'below' && props.gapBelow
          ? { edge, after: props.gapBelow, before: commit.commitId }
          : null
    if (!pair || draggedCommitId === pair.after || draggedCommitId === pair.before) {
      return null
    }
    return pair
  }

  // Also bound to dragenter: Chromium takes the drop effect from dragenter alone for the first
  // position over a new element, so an unhandled dragenter shows "no drop" until the next move.
  const onDragOver = (event: DragEvent) => {
    dragModifiers.onDragOver(event)
    const copy = dragModifiers.snapshot().copy
    const kind = dropKind(event, copy)
    const pair = kind === 'commit' ? insertPair(event) : null
    if (pair) {
      event.preventDefault()
      event.dataTransfer.dropEffect = copy ? 'copy' : 'move'
      setDropTarget(`insert-${pair.edge}`)
      return
    }
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
    const pair = kind === 'commit' ? insertPair(event) : null
    // A drop can swap the rows for its preview, which removes the dragged row before its
    // dragend fires, so the drag ends here too.
    draggedCommitId = null
    dragModifiers.onDragEnd()
    if (pair) {
      const { action, mode } = insertCommitAction(modifiers.copy, modifiers.alt)
      props.onDropCommit({
        kind: 'between',
        sourceId: event.dataTransfer.getData(COMMIT_MIME),
        afterId: pair.after,
        beforeId: pair.before,
        action,
        mode,
      })
    } else if (kind === 'commit') {
      const { action, mode } = dropCommitAction(modifiers.copy, modifiers.alt)
      props.onDropCommit({
        kind: 'onto',
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
    props.isDimmed && 'is-dimmed',
    dropTarget && `drop-${dropTarget}`,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={classes}
      data-commit-id={commit.commitId}
      role="treeitem"
      aria-level={1}
      aria-selected={props.isSelected}
      aria-expanded={canExpand ? isExpanded : undefined}
      aria-labelledby={`${nameId}-summary ${nameId}-status ${nameId}-change`}
      tabIndex={props.isTabStop ? 0 : -1}
      draggable={!commit.isImmutable || copyModifier}
      onDragStart={(event) => {
        const copy = event.ctrlKey || event.metaKey || dragModifiers.snapshot().copy
        if (commit.isImmutable && !copy) {
          event.preventDefault()
          return
        }
        dragModifiers.onDragStart(event, commit.isImmutable)
        draggedCommitId = commit.commitId
        event.dataTransfer.setData(COMMIT_MIME, commit.commitId)
        event.dataTransfer.effectAllowed = 'copyMove'
        if (isDesktop) {
          setTranslucentDragImage(event)
        }
      }}
      onDragEnd={() => {
        draggedCommitId = null
        dragModifiers.onDragEnd()
      }}
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={(event) => {
        // Moving between elements of this row also fires dragleave. Keep the marker then. A move
        // to another row needs no check: that row's dragenter has already taken the marker.
        if (!pointInside(event.currentTarget, event.clientX, event.clientY)) {
          setDropTarget(null)
        }
      }}
      onDrop={onDrop}
      onClick={() => {
        props.onSelect(commit.commitId)
        if (canExpand) {
          props.onToggle(commit)
        }
      }}
      onKeyDown={(event) => {
        // Enter and Space act like a click. Right opens and Left closes the row; on a row already
        // open or closed they move, which the tree does.
        if (event.target !== event.currentTarget) {
          return
        }
        const action = treeKeyAction(event)
        const toggles =
          canExpand &&
          ((action === 'expand' && !isExpanded) || (action === 'collapse' && isExpanded))
        if (action !== 'activate' && !toggles) {
          return
        }
        event.preventDefault()
        if (action === 'activate') {
          props.onSelect(commit.commitId)
        }
        if (canExpand) {
          props.onToggle(commit)
        }
      }}
      data-vscode-context={vscodeContext({
        webviewSection: 'ukemi.commit',
        repoId,
        commitId: commit.commitId,
        isWorkingCopy: commit.isWorkingCopy,
        isImmutable: commit.isImmutable,
        isEmpty: commit.isEmpty,
        hasConflict: commit.hasConflict,
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
            id={`${nameId}-change`}
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
            id={`${nameId}-summary`}
            className={`summary${summary ? '' : ' muted'}`}
            title={commit.description || undefined}
          >
            {summary || placeholder}
          </span>
          {statusText && (
            <span id={`${nameId}-status`} className="sr-only">
              {statusText}
            </span>
          )}
          {fileCount !== null && fileCount > 0 && <span className="file-count">{fileCount}</span>}
          {totals && <LineStats added={totals.added} removed={totals.removed} />}
          <span className="time" title={`${commit.author.name} · ${commit.committer.timestamp}`}>
            <RelativeTime timestamp={commit.committer.timestamp} />
          </span>
          <span className="actions">
            {!commit.isWorkingCopy && !commit.isImmutable && (
              <RowAction
                title="Edit this change"
                icon="edit"
                onClick={() => runCommand('ukemi.commit.edit', repoId, commit.commitId)}
              />
            )}
            {!commit.isImmutable && (
              <RowAction
                title="Describe"
                icon="comment-discussion-quote"
                onClick={() => props.onDescribe(commit)}
              />
            )}
            {props.canSquash && (
              <RowAction
                title="Squash into parent"
                icon="fold-down"
                onClick={() => runCommand('ukemi.commit.squash', repoId, commit.commitId)}
              />
            )}
            <RowAction
              title="New change on top"
              icon="add"
              onClick={() => runCommand('ukemi.commit.new', repoId, commit.commitId)}
            />
          </span>
        </div>
        <RequestRow
          commit={commit}
          repoId={repoId}
          hasForge={props.hasForge}
          ciOnlyMine={settings.ciOnlyMine}
          showGitTags={settings.showGitTags}
          refreshError={props.requestRefreshError}
        />
        {isExpanded && canExpand && (
          <FileList
            commit={commit}
            files={props.files}
            repoId={repoId}
            showFullPaths={settings.showFullPaths}
            showLineStats={settings.showLineStats}
            changedFilesView={settings.changedFilesView}
            level={2}
          />
        )}
      </div>
    </div>
  )
})
