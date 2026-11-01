import { useState, type CSSProperties, type ReactNode } from 'react'
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
import { FILE_STATUS_LETTER, type ChangedFile } from '../../../shared/model'
import { relativeTime } from '../shared/format'
import { useElementHeight, useHostMessages } from '../shared/hooks'
import { LoadingScreen } from '../shared/LoadingMark'
import { postMessage } from '../shared/vscodeApi'

const send = (message: CleanupWebviewMessage) => postMessage(message)

interface Column {
  className: string
  header?: string
}

const BOOKMARKS_COLUMNS: readonly Column[] = [
  { className: 'col-check' },
  { className: 'col-name', header: 'Bookmark' },
  { className: 'col-reason', header: 'Reason' },
  { className: 'col-text', header: 'Description' },
  { className: 'col-option', header: 'Abandon commits' },
]

const WORKSPACES_COLUMNS: readonly Column[] = [
  { className: 'col-check' },
  { className: 'col-name', header: 'Workspace' },
  { className: 'col-text', header: 'Detail' },
  { className: 'col-option', header: 'Delete files' },
]

const DIVERGENT_COLUMNS: readonly Column[] = [
  { className: 'col-check' },
  { className: 'col-id', header: 'Change' },
  { className: 'col-text', header: 'Description' },
  { className: 'col-note', header: 'Reason' },
]

const DELETED_COLUMNS: readonly Column[] = [
  { className: 'col-check' },
  { className: 'col-name', header: 'Bookmark' },
  { className: 'col-text', header: 'Detail' },
  { className: 'col-remote', header: 'Delete remote' },
]

const UNDESCRIBED_COLUMNS: readonly Column[] = [
  { className: 'col-check' },
  { className: 'col-files' },
  { className: 'col-id', header: 'Change' },
  { className: 'col-id', header: 'Commit' },
  { className: 'col-note', header: 'When' },
  { className: 'col-text', header: 'Note' },
  { className: 'col-action' },
]

function toggle(current: ReadonlySet<string>, name: string, selected: boolean): Set<string> {
  const next = new Set(current)
  if (selected) {
    next.add(name)
  } else {
    next.delete(name)
  }
  return next
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
  const [abandonCommits, setAbandonCommits] = useState<ReadonlySet<string>>(new Set())
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(new Set())
  const [deleteRemote, setDeleteRemote] = useState<ReadonlySet<string>>(new Set())
  const [workspaces, setWorkspaces] = useState<ReadonlySet<string>>(new Set())
  const [deleteFiles, setDeleteFiles] = useState<ReadonlySet<string>>(new Set())
  const [drops, setDrops] = useState<ReadonlySet<string>>(new Set())
  const [undescribedDrops, setUndescribedDrops] = useState<ReadonlySet<string>>(new Set())
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
      if (message.type !== 'load') {
        return
      }
      const next = message.snapshot
      setSnapshot(next)
      setBookmarks(
        new Set(next.bookmarks.filter((bookmark) => bookmark.checked).map((b) => b.name)),
      )
      setAbandonCommits(new Set())
      setDeleted(
        new Set(next.deletedBookmarks.filter((bookmark) => bookmark.checked).map((b) => b.name)),
      )
      setDeleteRemote(new Set())
      setWorkspaces(
        new Set(next.workspaces.filter((workspace) => workspace.checked).map((w) => w.name)),
      )
      setDeleteFiles(new Set())
      setDrops(initialDrops(next))
      setUndescribedDrops(new Set())
      setExpanded(new Set())
      setFilesByCommit({})
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

  const count = bookmarks.size + deleted.size + workspaces.size + drops.size + undescribedDrops.size
  const selection: CleanupSelection = {
    bookmarks: [...bookmarks],
    abandonBookmarkCommits: [...abandonCommits].filter((name) => bookmarks.has(name)),
    deletedBookmarks: [...deleted],
    deleteRemote: [...deleteRemote].filter((name) => deleted.has(name)),
    workspaces: [...workspaces],
    deleteWorkspaceFiles: [...deleteFiles].filter((name) => workspaces.has(name)),
    divergent: [...drops],
    undescribed: [...undescribedDrops],
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
            onClick={() => send({ type: 'apply', selection })}
          >
            {count === 0 ? 'Clean up' : `Clean up ${count}`}
          </button>
        </div>
      </header>
      {snapshot.bookmarks.length > 0 && (
        <CleanupSection
          title="Bookmarks"
          count={snapshot.bookmarks.length}
          tableClass="bookmarks"
          columns={BOOKMARKS_COLUMNS}
          note={
            <>
              Forgets the local bookmark and its Git branch (refs/heads/…). The remote bookmark
              stays. Abandon commits deletes only commits that are on this bookmark and not on trunk
              or another bookmark, back to that fork. A bookmark already in trunk has none of those
              commits, so the control stays off.
            </>
          }
        >
          <tbody>
            {snapshot.bookmarks.map((bookmark) => (
              <tr key={bookmark.name}>
                <td>
                  <input
                    id={`bookmark-${bookmark.name}`}
                    type="checkbox"
                    checked={bookmarks.has(bookmark.name)}
                    onChange={(event) => {
                      const selected = event.target.checked
                      setBookmarks(toggle(bookmarks, bookmark.name, selected))
                      if (!selected) {
                        setAbandonCommits(toggle(abandonCommits, bookmark.name, false))
                      }
                    }}
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
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Abandon commits for ${bookmark.name}`}
                    checked={
                      bookmark.abandonCommitIds.length > 0 &&
                      bookmarks.has(bookmark.name) &&
                      abandonCommits.has(bookmark.name)
                    }
                    disabled={
                      bookmark.abandonCommitIds.length === 0 || !bookmarks.has(bookmark.name)
                    }
                    onChange={(event) =>
                      setAbandonCommits(toggle(abandonCommits, bookmark.name, event.target.checked))
                    }
                  />
                  {bookmark.abandonCommitIds.length > 0 && (
                    <span className="muted"> {bookmark.abandonCommitIds.length}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </CleanupSection>
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
        <CleanupSection
          title="Workspaces"
          count={snapshot.workspaces.length}
          tableClass="workspaces"
          columns={WORKSPACES_COLUMNS}
          note={
            <>
              Forgets the workspace in the repository. The folder and its files stay on disk unless
              Delete files is checked. Delete files removes that folder after the workspace is
              forgotten. jj undo does not restore those files.
            </>
          }
        >
          <tbody>
            {snapshot.workspaces.map((workspace) => (
              <tr key={workspace.name}>
                <td>
                  <input
                    id={`workspace-${workspace.name}`}
                    type="checkbox"
                    checked={workspaces.has(workspace.name)}
                    onChange={(event) => {
                      const selected = event.target.checked
                      setWorkspaces(toggle(workspaces, workspace.name, selected))
                      if (!selected) {
                        setDeleteFiles(toggle(deleteFiles, workspace.name, false))
                      }
                    }}
                  />
                </td>
                <Cell htmlFor={`workspace-${workspace.name}`} className="name">
                  {workspace.name}
                </Cell>
                <Cell htmlFor={`workspace-${workspace.name}`} className="muted">
                  {workspace.detail}
                </Cell>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Delete files for ${workspace.name}`}
                    checked={workspace.canDeleteFiles && deleteFiles.has(workspace.name)}
                    disabled={!workspace.canDeleteFiles}
                    onChange={(event) => {
                      const selected = event.target.checked
                      setDeleteFiles(toggle(deleteFiles, workspace.name, selected))
                      if (selected) {
                        setWorkspaces(toggle(workspaces, workspace.name, true))
                      }
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </CleanupSection>
      )}
      {snapshot.divergent.length > 0 && (
        <CleanupSection
          title="Divergent changes"
          count={snapshot.divergent.length}
          tableClass="divergent"
          columns={DIVERGENT_COLUMNS}
          note={
            <>
              Abandons the checked commits and rebases kept children onto the commit you keep. The
              working copy is left unchecked. An immutable commit, or a commit with an immutable
              child, cannot be abandoned.
            </>
          }
        >
          {snapshot.divergent.map((group) => (
            <DivergenceGroup
              key={group.changeId}
              group={group}
              drops={drops}
              onToggle={(commitId, selected) => setDrops(toggle(drops, commitId, selected))}
            />
          ))}
        </CleanupSection>
      )}
      {snapshot.undescribed.length > 0 && (
        <UndescribedCommits
          commits={snapshot.undescribed}
          truncated={snapshot.undescribedTruncated}
          expanded={expanded}
          filesByCommit={filesByCommit}
          selected={undescribedDrops}
          onSelect={(commitId, selected) =>
            setUndescribedDrops(toggle(undescribedDrops, commitId, selected))
          }
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

function CleanupSection({
  title,
  count,
  note,
  tableClass,
  caption = title,
  columns,
  children,
}: {
  title: string
  count: number
  note: ReactNode
  tableClass: string
  caption?: string
  columns: readonly Column[]
  children: ReactNode
}) {
  return (
    <section className="cleanup-section">
      <h2>
        {title} <span className="muted">({count})</span>
      </h2>
      <p className="muted cleanup-note">{note}</p>
      <table className={`cleanup-table ${tableClass}`}>
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          {columns.map((column, index) => (
            <col key={index} className={column.className} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={index} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        {children}
      </table>
    </section>
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
    <CleanupSection
      title="Deleted bookmarks"
      count={bookmarks.length}
      tableClass="deleted"
      columns={DELETED_COLUMNS}
      note={
        <>
          Forgets the local record. The remote stays unless Delete remote is checked. That checkbox
          pushes the deletion.
        </>
      }
    >
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
    </CleanupSection>
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
  if (!commit.canAbandon) {
    notes.push('cannot abandon')
  }
  return notes.join(', ')
}

function UndescribedCommits({
  commits,
  truncated,
  expanded,
  filesByCommit,
  selected,
  onSelect,
  onToggle,
}: {
  commits: readonly CleanupUndescribed[]
  truncated: boolean
  expanded: ReadonlySet<string>
  filesByCommit: Readonly<Record<string, ChangedFile[]>>
  selected: ReadonlySet<string>
  onSelect: (commitId: string, selected: boolean) => void
  onToggle: (commitId: string) => void
}) {
  const now = Date.now()
  return (
    <CleanupSection
      title="No description"
      count={commits.length}
      tableClass="undescribed"
      caption="Commits with no description"
      columns={UNDESCRIBED_COLUMNS}
      note={
        <>
          Abandons the checked commits and rebases their children onto the parent. Nothing is
          checked at first. An immutable commit, or a commit with an immutable child, cannot be
          abandoned. Open diff only shows the change.
          {truncated ? ` Showing the latest ${UNDESCRIBED_LIMIT}.` : ''}
        </>
      }
    >
      {commits.map((commit) => (
        <tbody key={commit.commitId}>
          <tr className={commit.canAbandon ? undefined : 'is-disabled'}>
            <td>
              <input
                type="checkbox"
                aria-label={`Abandon commit ${commit.commitPrefix}`}
                checked={commit.canAbandon && selected.has(commit.commitId)}
                disabled={!commit.canAbandon}
                onChange={(event) => onSelect(commit.commitId, event.target.checked)}
              />
            </td>
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
              <td colSpan={7}>
                <ChangedFiles commitId={commit.commitId} files={filesByCommit[commit.commitId]} />
              </td>
            </tr>
          )}
        </tbody>
      ))}
    </CleanupSection>
  )
}

function ChangedFiles({ commitId, files }: { commitId: string; files: ChangedFile[] | undefined }) {
  if (!files) {
    return <LoadingScreen heading="Loading…" />
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
            {FILE_STATUS_LETTER[file.status]} {file.path}
          </button>
        </li>
      ))}
    </ul>
  )
}
