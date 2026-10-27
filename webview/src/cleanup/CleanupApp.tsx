import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
  UNDESCRIBED_LIMIT,
  type CleanupDeletedBookmark,
  type CleanupDivergence,
  type CleanupHostMessage,
  type CleanupRevision,
  type CleanupSelection,
  type CleanupSnapshot,
  type CleanupUndescribed,
  type CleanupWebviewMessage,
} from '../../../shared/cleanup'
import type { ChangedFile } from '../../../shared/model'
import { relativeTime } from '../shared/format'
import { postMessage } from '../shared/vscodeApi'

const send = (message: CleanupWebviewMessage) => postMessage(message)

const FILE_STATUS: Record<ChangedFile['status'], string> = {
  added: 'A',
  modified: 'M',
  removed: 'D',
  renamed: 'R',
  copied: 'C',
}

function isEmpty(snapshot: CleanupSnapshot): boolean {
  return (
    snapshot.bookmarks.length === 0 &&
    snapshot.deletedBookmarks.length === 0 &&
    snapshot.workspaces.length === 0 &&
    snapshot.divergent.length === 0 &&
    snapshot.undescribed.length === 0
  )
}

function revisionNote(revision: CleanupRevision): string {
  const notes: string[] = []
  if (revision.isWorkingCopy) {
    notes.push('working copy')
  }
  if (!revision.canDrop) {
    notes.push('cannot abandon')
  }
  return notes.join(', ')
}

function initialDrops(snapshot: CleanupSnapshot): Set<string> {
  return new Set(
    snapshot.divergent.flatMap((group) =>
      group.revisions.filter((revision) => revision.checked).map((revision) => revision.commitId),
    ),
  )
}

export function CleanupApp() {
  const [snapshot, setSnapshot] = useState<CleanupSnapshot | null>(null)
  const [bookmarks, setBookmarks] = useState<ReadonlySet<string>>(new Set())
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(new Set())
  const [deleteRemote, setDeleteRemote] = useState<ReadonlySet<string>>(new Set())
  const [workspaces, setWorkspaces] = useState<ReadonlySet<string>>(new Set())
  const [drops, setDrops] = useState<ReadonlySet<string>>(new Set())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [filesByCommit, setFilesByCommit] = useState<Readonly<Record<string, ChangedFile[]>>>({})
  const [headerHeight, setHeaderHeight] = useState(0)
  const headerRef = useCallback((node: HTMLElement | null) => {
    if (!node) {
      return
    }
    const observer = new ResizeObserver(() => setHeaderHeight(node.offsetHeight))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent<CleanupHostMessage>) => {
      if (event.data.type === 'files') {
        const { commitId, files } = event.data
        setFilesByCommit((current) => ({ ...current, [commitId]: files }))
        return
      }
      if (event.data.type !== 'load') {
        return
      }
      const next = event.data.snapshot
      setSnapshot(next)
      setBookmarks(
        new Set(next.bookmarks.filter((bookmark) => bookmark.checked).map((b) => b.name)),
      )
      setDeleted(
        new Set(next.deletedBookmarks.filter((bookmark) => bookmark.checked).map((b) => b.name)),
      )
      setDeleteRemote(new Set())
      setWorkspaces(
        new Set(next.workspaces.filter((workspace) => workspace.checked).map((w) => w.name)),
      )
      setDrops(initialDrops(next))
      setExpanded(new Set())
      setFilesByCommit({})
    }
    window.addEventListener('message', onMessage)
    send({ type: 'ready' })
    return () => window.removeEventListener('message', onMessage)
  }, [])

  if (!snapshot) {
    return <div className="muted padded">Loading…</div>
  }
  if (isEmpty(snapshot)) {
    return (
      <div className="cleanup">
        <h1>Clean up</h1>
        <p className="muted">Nothing to clean up.</p>
      </div>
    )
  }

  const count = bookmarks.size + deleted.size + workspaces.size + drops.size
  const selection: CleanupSelection = {
    bookmarks: [...bookmarks],
    deletedBookmarks: [...deleted],
    deleteRemote: [...deleteRemote].filter((name) => deleted.has(name)),
    workspaces: [...workspaces],
    divergent: [...drops],
  }
  const toggle = (current: ReadonlySet<string>, name: string, selected: boolean) => {
    const next = new Set(current)
    if (selected) {
      next.add(name)
    } else {
      next.delete(name)
    }
    return next
  }

  return (
    <div
      className="cleanup"
      style={{ '--cleanup-header-height': `${headerHeight}px` } as CSSProperties}
    >
      <header className="cleanup-header" ref={headerRef}>
        <h1>Clean up</h1>
        <p className="muted">
          Checked rows are removed. Forget leaves remote branches and workspace files in place.
          Delete remote pushes that deletion.
        </p>
        <div className="cleanup-buttons">
          <button className="button secondary" onClick={() => send({ type: 'cancel' })}>
            Cancel
          </button>
          <button
            className="button"
            disabled={count === 0}
            onClick={() => send({ type: 'apply', selection })}
          >
            {count === 0 ? 'Clean up' : `Clean up ${count}`}
          </button>
        </div>
      </header>
      {snapshot.bookmarks.length > 0 && (
        <section className="cleanup-section">
          <h2>
            Bookmarks <span className="muted">({snapshot.bookmarks.length})</span>
          </h2>
          <table className="cleanup-table bookmarks">
            <caption className="sr-only">Bookmarks</caption>
            <colgroup>
              <col className="col-check" />
              <col className="col-name" />
              <col className="col-reason" />
              <col className="col-text" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">Bookmark</th>
                <th scope="col">Reason</th>
                <th scope="col">Description</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.bookmarks.map((bookmark) => (
                <tr key={bookmark.name}>
                  <td>
                    <input
                      id={`bookmark-${bookmark.name}`}
                      type="checkbox"
                      checked={bookmarks.has(bookmark.name)}
                      onChange={(event) =>
                        setBookmarks(toggle(bookmarks, bookmark.name, event.target.checked))
                      }
                    />
                  </td>
                  <Cell htmlFor={`bookmark-${bookmark.name}`} className="name">
                    {bookmark.name}
                  </Cell>
                  <Cell htmlFor={`bookmark-${bookmark.name}`} className="muted">
                    {bookmark.detail}
                  </Cell>
                  <Cell htmlFor={`bookmark-${bookmark.name}`}>
                    {bookmark.description || '(no description)'}
                  </Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {snapshot.deletedBookmarks.length > 0 && (
        <DeletedBookmarks
          bookmarks={snapshot.deletedBookmarks}
          selected={deleted}
          deleteRemote={deleteRemote}
          onToggle={(name, selected) => {
            setDeleted(toggle(deleted, name, selected))
            if (!selected) {
              setDeleteRemote(toggle(deleteRemote, name, false))
            }
          }}
          onDeleteRemote={(name, selected) => {
            setDeleteRemote(toggle(deleteRemote, name, selected))
            if (selected) {
              setDeleted(toggle(deleted, name, true))
            }
          }}
        />
      )}
      {snapshot.workspaces.length > 0 && (
        <section className="cleanup-section">
          <h2>
            Workspaces <span className="muted">({snapshot.workspaces.length})</span>
          </h2>
          <table className="cleanup-table workspaces">
            <caption className="sr-only">Workspaces</caption>
            <colgroup>
              <col className="col-check" />
              <col className="col-name" />
              <col className="col-text" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">Workspace</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.workspaces.map((workspace) => (
                <tr key={workspace.name}>
                  <td>
                    <input
                      id={`workspace-${workspace.name}`}
                      type="checkbox"
                      checked={workspaces.has(workspace.name)}
                      onChange={(event) =>
                        setWorkspaces(toggle(workspaces, workspace.name, event.target.checked))
                      }
                    />
                  </td>
                  <Cell htmlFor={`workspace-${workspace.name}`} className="name">
                    {workspace.name}
                  </Cell>
                  <Cell htmlFor={`workspace-${workspace.name}`} className="muted">
                    {workspace.detail}
                  </Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {snapshot.divergent.length > 0 && (
        <section className="cleanup-section">
          <h2>
            Divergent changes <span className="muted">({snapshot.divergent.length})</span>
          </h2>
          <table className="cleanup-table divergent">
            <caption className="sr-only">Divergent changes</caption>
            <colgroup>
              <col className="col-check" />
              <col className="col-id" />
              <col className="col-text" />
              <col className="col-note" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">Change</th>
                <th scope="col">Description</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            {snapshot.divergent.map((group) => (
              <DivergenceGroup
                key={group.changeId}
                group={group}
                drops={drops}
                onToggle={(commitId, selected) => setDrops(toggle(drops, commitId, selected))}
              />
            ))}
          </table>
        </section>
      )}
      {snapshot.undescribed.length > 0 && (
        <UndescribedCommits
          commits={snapshot.undescribed}
          truncated={snapshot.undescribedTruncated}
          expanded={expanded}
          filesByCommit={filesByCommit}
          onToggle={(commitId) => {
            const open = expanded.has(commitId)
            setExpanded(toggle(expanded, commitId, !open))
            if (!open && filesByCommit[commitId] === undefined) {
              send({ type: 'loadFiles', commitId })
            }
          }}
        />
      )}
    </div>
  )
}

function Cell({
  htmlFor,
  className,
  children,
}: {
  htmlFor: string
  className?: string
  children: ReactNode
}) {
  return (
    <td className={className}>
      <label htmlFor={htmlFor}>{children}</label>
    </td>
  )
}

function DivergenceGroup({
  group,
  drops,
  onToggle,
}: {
  group: CleanupDivergence
  drops: ReadonlySet<string>
  onToggle: (commitId: string, selected: boolean) => void
}) {
  return (
    <tbody>
      <tr className="group-row">
        <th />
        <th colSpan={3} scope="rowgroup">
          {group.changePrefix}
        </th>
      </tr>
      {group.revisions.map((revision) => {
        const inputId = `drop-${revision.commitId}`
        return (
          <tr key={revision.commitId} className={revision.canDrop ? undefined : 'is-disabled'}>
            <td>
              <input
                id={inputId}
                type="checkbox"
                checked={revision.canDrop && drops.has(revision.commitId)}
                disabled={!revision.canDrop}
                onChange={(event) => onToggle(revision.commitId, event.target.checked)}
              />
            </td>
            <Cell htmlFor={inputId} className="name">
              {revision.commitPrefix}
            </Cell>
            <Cell htmlFor={inputId}>{revision.description || '(no description)'}</Cell>
            <Cell htmlFor={inputId} className="muted">
              {revisionNote(revision)}
            </Cell>
          </tr>
        )
      })}
    </tbody>
  )
}

function DeletedBookmarks({
  bookmarks,
  selected,
  deleteRemote,
  onToggle,
  onDeleteRemote,
}: {
  bookmarks: readonly CleanupDeletedBookmark[]
  selected: ReadonlySet<string>
  deleteRemote: ReadonlySet<string>
  onToggle: (name: string, selected: boolean) => void
  onDeleteRemote: (name: string, selected: boolean) => void
}) {
  return (
    <section className="cleanup-section">
      <h2>
        Deleted bookmarks <span className="muted">({bookmarks.length})</span>
      </h2>
      <table className="cleanup-table deleted">
        <caption className="sr-only">Deleted bookmarks</caption>
        <colgroup>
          <col className="col-check" />
          <col className="col-name" />
          <col className="col-text" />
          <col className="col-remote" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">Bookmark</th>
            <th scope="col">Detail</th>
            <th scope="col">Delete remote</th>
          </tr>
        </thead>
        <tbody>
          {bookmarks.map((bookmark) => {
            const inputId = `deleted-${bookmark.name}`
            return (
              <tr key={bookmark.name}>
                <td>
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={selected.has(bookmark.name)}
                    onChange={(event) => onToggle(bookmark.name, event.target.checked)}
                  />
                </td>
                <Cell htmlFor={inputId} className="name">
                  {bookmark.name}
                </Cell>
                <Cell htmlFor={inputId} className="muted">
                  {bookmark.detail}
                </Cell>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Delete remote bookmark ${bookmark.name}`}
                    checked={bookmark.canDeleteRemote && deleteRemote.has(bookmark.name)}
                    disabled={!bookmark.canDeleteRemote}
                    onChange={(event) => onDeleteRemote(bookmark.name, event.target.checked)}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

function undescribedNote(commit: CleanupUndescribed): string {
  const notes: string[] = []
  if (commit.isEmpty) {
    notes.push('empty')
  }
  if (commit.isImmutable) {
    notes.push('immutable')
  }
  return notes.join(', ')
}

function UndescribedCommits({
  commits,
  truncated,
  expanded,
  filesByCommit,
  onToggle,
}: {
  commits: readonly CleanupUndescribed[]
  truncated: boolean
  expanded: ReadonlySet<string>
  filesByCommit: Readonly<Record<string, ChangedFile[]>>
  onToggle: (commitId: string) => void
}) {
  const now = Date.now()
  return (
    <section className="cleanup-section">
      <h2>
        No description <span className="muted">({commits.length})</span>
      </h2>
      <p className="muted cleanup-note">
        Listed only.
        {truncated ? ` Showing the latest ${UNDESCRIBED_LIMIT}.` : ''}
      </p>
      <table className="cleanup-table undescribed">
        <caption className="sr-only">Commits with no description</caption>
        <colgroup>
          <col className="col-files" />
          <col className="col-id" />
          <col className="col-id" />
          <col className="col-note" />
          <col className="col-text" />
          <col className="col-action" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">Change</th>
            <th scope="col">Commit</th>
            <th scope="col">When</th>
            <th scope="col">Note</th>
            <th scope="col" />
          </tr>
        </thead>
        {commits.map((commit) => (
          <tbody key={commit.commitId}>
            <tr>
              <td>
                <button
                  type="button"
                  className="cleanup-file"
                  aria-expanded={expanded.has(commit.commitId)}
                  onClick={() => onToggle(commit.commitId)}
                >
                  {expanded.has(commit.commitId) ? 'Hide' : 'Files'}
                </button>
              </td>
              <td className="name">{commit.changePrefix}</td>
              <td className="name">{commit.commitPrefix}</td>
              <td className="muted">{relativeTime(commit.timestamp, now)}</td>
              <td className="muted">{undescribedNote(commit)}</td>
              <td>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => send({ type: 'openDiff', commitId: commit.commitId })}
                >
                  Open diff
                </button>
              </td>
            </tr>
            {expanded.has(commit.commitId) && (
              <tr>
                <td colSpan={6}>
                  <ChangedFiles commitId={commit.commitId} files={filesByCommit[commit.commitId]} />
                </td>
              </tr>
            )}
          </tbody>
        ))}
      </table>
    </section>
  )
}

function ChangedFiles({ commitId, files }: { commitId: string; files: ChangedFile[] | undefined }) {
  if (!files) {
    return <p className="muted">Loading…</p>
  }
  if (files.length === 0) {
    return <p className="muted">(no file changes)</p>
  }
  return (
    <ul className="cleanup-files">
      {files.map((file) => (
        <li key={file.path}>
          <button
            type="button"
            className="cleanup-file"
            onClick={() => send({ type: 'openFile', commitId, path: file.path })}
          >
            {FILE_STATUS[file.status]} {file.path}
          </button>
        </li>
      ))}
    </ul>
  )
}
