import { useReducer, useState, type CSSProperties } from 'react'
import type {
  CleanupHostMessage,
  CleanupSnapshot,
  CleanupWebviewMessage,
} from '../../../shared/cleanup'
import type { ChangedFile } from '../../../shared/model'
import { useElementHeight, useHostMessages } from '../shared/hooks'
import { LoadingScreen } from '../shared/LoadingMark'
import { useSend } from '../shared/hostChannel'
import { cleanupReducer, countOf, INITIAL_CLEANUP, selectionOf, toggle } from './cleanupChoices'
import {
  BookmarkSection,
  DeletedBookmarkSection,
  DivergentSection,
  UndescribedSection,
  WorkspaceSection,
} from './CleanupSections'

function isEmpty(snapshot: CleanupSnapshot): boolean {
  return (
    snapshot.bookmarks.length === 0 &&
    snapshot.deletedBookmarks.length === 0 &&
    snapshot.workspaces.length === 0 &&
    snapshot.divergent.length === 0 &&
    snapshot.undescribed.length === 0
  )
}

export function CleanupApp() {
  const send = useSend<CleanupWebviewMessage>()
  const [{ snapshot, choices }, dispatch] = useReducer(cleanupReducer, INITIAL_CLEANUP)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [filesByCommit, setFilesByCommit] = useState<Readonly<Record<string, ChangedFile[]>>>({})
  const [headerRef, headerHeight] = useElementHeight()

  useHostMessages<CleanupHostMessage>(
    (message) => {
      if (message.type === 'files') {
        const { commitId, files } = message
        setFilesByCommit((current) => ({ ...current, [commitId]: files }))
        return
      }
      if (message.type === 'load') {
        dispatch({ type: 'load', snapshot: message.snapshot })
      }
    },
    { type: 'ready' } satisfies CleanupWebviewMessage,
  )

  if (!snapshot) {
    return <LoadingScreen heading="Loading…" />
  }
  if (isEmpty(snapshot)) {
    return (
      <div className="cleanup">
        <h1>Clean up</h1>
        <p className="muted">Nothing to clean up.</p>
      </div>
    )
  }

  const count = countOf(choices)
  const toggleFiles = (commitId: string) => {
    const open = expanded.has(commitId)
    setExpanded(toggle(expanded, commitId, !open))
    if (!open && filesByCommit[commitId] === undefined) {
      send({ type: 'loadFiles', commitId })
    }
  }
  return (
    <div
      className="cleanup"
      style={{ '--cleanup-header-height': `${headerHeight}px` } as CSSProperties}
    >
      <header className="cleanup-header" ref={headerRef}>
        <div className="cleanup-warning" role="alert">
          <i className="codicon codicon-warning" aria-hidden="true" />
          <p>Checked rows are removed. jj undo can restore the repository.</p>
        </div>
        <h1>Clean up</h1>
        <div className="cleanup-buttons">
          <button className="button secondary" onClick={() => send({ type: 'cancel' })}>
            Cancel
          </button>
          <button
            className="button"
            disabled={count === 0}
            onClick={() => send({ type: 'apply', selection: selectionOf(choices) })}
          >
            {count === 0 ? 'Clean up' : `Clean up ${count}`}
          </button>
        </div>
      </header>
      {snapshot.bookmarks.length > 0 && (
        <BookmarkSection bookmarks={snapshot.bookmarks} choices={choices} dispatch={dispatch} />
      )}
      {snapshot.deletedBookmarks.length > 0 && (
        <DeletedBookmarkSection
          bookmarks={snapshot.deletedBookmarks}
          choices={choices}
          dispatch={dispatch}
        />
      )}
      {snapshot.workspaces.length > 0 && (
        <WorkspaceSection workspaces={snapshot.workspaces} choices={choices} dispatch={dispatch} />
      )}
      {snapshot.divergent.length > 0 && (
        <DivergentSection groups={snapshot.divergent} choices={choices} dispatch={dispatch} />
      )}
      {snapshot.undescribed.length > 0 && (
        <UndescribedSection
          commits={snapshot.undescribed}
          truncated={snapshot.undescribedTruncated}
          expanded={expanded}
          filesByCommit={filesByCommit}
          choices={choices}
          dispatch={dispatch}
          onToggleFiles={toggleFiles}
        />
      )}
    </div>
  )
}
