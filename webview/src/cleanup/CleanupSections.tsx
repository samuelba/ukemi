import type { Dispatch, ReactNode } from 'react'
import {
  UNDESCRIBED_LIMIT,
  type CleanupBookmark,
  type CleanupDeletedBookmark,
  type CleanupDivergence,
  type CleanupRevision,
  type CleanupUndescribed,
  type CleanupWebviewMessage,
  type CleanupWorkspace,
} from '../../../shared/cleanup'
import { FILE_STATUS_LETTER, type ChangedFile } from '../../../shared/model'
import { relativeTime } from '../shared/format'
import { LoadingScreen } from '../shared/LoadingMark'
import { useSend } from '../shared/hostChannel'
import type { CleanupChoices } from './carriedSelection'
import type { CleanupAction } from './cleanupChoices'

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

// What every section gets: the form's choices and the way to change them.
interface ChoiceProps {
  choices: CleanupChoices
  dispatch: Dispatch<CleanupAction>
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

export function BookmarkSection({
  bookmarks,
  choices,
  dispatch,
}: ChoiceProps & { bookmarks: readonly CleanupBookmark[] }) {
  return (
    <CleanupSection
      title="Bookmarks"
      count={bookmarks.length}
      tableClass="bookmarks"
      columns={BOOKMARKS_COLUMNS}
      note={
        <>
          Forgets the local bookmark and its Git branch (refs/heads/…). The remote bookmark stays.
          Abandon commits deletes only commits that are on this bookmark and not on trunk or another
          bookmark, back to that fork. A bookmark already in trunk has none of those commits, so the
          control stays off.
        </>
      }
    >
      <tbody>
        {bookmarks.map((bookmark) => {
          const inputId = `bookmark-${bookmark.name}`
          const isChecked = choices.bookmarks.has(bookmark.name)
          const canAbandon = bookmark.abandonCommitIds.length > 0
          return (
            <tr key={bookmark.name}>
              <td>
                <input
                  id={inputId}
                  type="checkbox"
                  checked={isChecked}
                  onChange={(event) =>
                    dispatch({
                      type: 'bookmark',
                      name: bookmark.name,
                      selected: event.target.checked,
                    })
                  }
                />
              </td>
              <Cell htmlFor={inputId} className="name">
                {bookmark.name}
              </Cell>
              <Cell htmlFor={inputId} className="muted">
                {bookmark.detail}
              </Cell>
              <Cell htmlFor={inputId}>{bookmark.description || '(no description)'}</Cell>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Abandon commits for ${bookmark.name}`}
                  checked={canAbandon && isChecked && choices.abandonCommits.has(bookmark.name)}
                  disabled={!canAbandon || !isChecked}
                  onChange={(event) =>
                    dispatch({
                      type: 'abandonCommits',
                      name: bookmark.name,
                      selected: event.target.checked,
                    })
                  }
                />
                {canAbandon && <span className="muted"> {bookmark.abandonCommitIds.length}</span>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </CleanupSection>
  )
}

export function DeletedBookmarkSection({
  bookmarks,
  choices,
  dispatch,
}: ChoiceProps & { bookmarks: readonly CleanupDeletedBookmark[] }) {
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
                  checked={choices.deleted.has(bookmark.name)}
                  onChange={(event) =>
                    dispatch({
                      type: 'deleted',
                      name: bookmark.name,
                      selected: event.target.checked,
                    })
                  }
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
                  checked={bookmark.canDeleteRemote && choices.deleteRemote.has(bookmark.name)}
                  disabled={!bookmark.canDeleteRemote}
                  onChange={(event) =>
                    dispatch({
                      type: 'deleteRemote',
                      name: bookmark.name,
                      selected: event.target.checked,
                    })
                  }
                />
              </td>
            </tr>
          )
        })}
      </tbody>
    </CleanupSection>
  )
}

export function WorkspaceSection({
  workspaces,
  choices,
  dispatch,
}: ChoiceProps & { workspaces: readonly CleanupWorkspace[] }) {
  return (
    <CleanupSection
      title="Workspaces"
      count={workspaces.length}
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
        {workspaces.map((workspace) => {
          const inputId = `workspace-${workspace.name}`
          return (
            <tr key={workspace.name}>
              <td>
                <input
                  id={inputId}
                  type="checkbox"
                  checked={choices.workspaces.has(workspace.name)}
                  onChange={(event) =>
                    dispatch({
                      type: 'workspace',
                      name: workspace.name,
                      selected: event.target.checked,
                    })
                  }
                />
              </td>
              <Cell htmlFor={inputId} className="name">
                {workspace.name}
              </Cell>
              <Cell htmlFor={inputId} className="muted">
                {workspace.detail}
              </Cell>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Delete files for ${workspace.name}`}
                  checked={workspace.canDeleteFiles && choices.deleteFiles.has(workspace.name)}
                  disabled={!workspace.canDeleteFiles}
                  onChange={(event) =>
                    dispatch({
                      type: 'deleteFiles',
                      name: workspace.name,
                      selected: event.target.checked,
                    })
                  }
                />
              </td>
            </tr>
          )
        })}
      </tbody>
    </CleanupSection>
  )
}

export function DivergentSection({
  groups,
  choices,
  dispatch,
}: ChoiceProps & { groups: readonly CleanupDivergence[] }) {
  return (
    <CleanupSection
      title="Divergent changes"
      count={groups.length}
      tableClass="divergent"
      columns={DIVERGENT_COLUMNS}
      note={
        <>
          Abandons the checked commits and rebases kept children onto the commit you keep. The
          working copy is left unchecked. An immutable commit, or a commit with an immutable child,
          cannot be abandoned.
        </>
      }
    >
      {groups.map((group) => (
        <DivergenceGroup key={group.changeId} group={group} choices={choices} dispatch={dispatch} />
      ))}
    </CleanupSection>
  )
}

function DivergenceGroup({ group, choices, dispatch }: ChoiceProps & { group: CleanupDivergence }) {
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
                checked={revision.canDrop && choices.drops.has(revision.commitId)}
                disabled={!revision.canDrop}
                onChange={(event) =>
                  dispatch({
                    type: 'drop',
                    commitId: revision.commitId,
                    selected: event.target.checked,
                  })
                }
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

export function UndescribedSection({
  commits,
  truncated,
  expanded,
  filesByCommit,
  choices,
  dispatch,
  onToggleFiles,
}: ChoiceProps & {
  commits: readonly CleanupUndescribed[]
  truncated: boolean
  expanded: ReadonlySet<string>
  filesByCommit: Readonly<Record<string, ChangedFile[]>>
  onToggleFiles: (commitId: string) => void
}) {
  const send = useSend<CleanupWebviewMessage>()
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
                checked={commit.canAbandon && choices.undescribedDrops.has(commit.commitId)}
                disabled={!commit.canAbandon}
                onChange={(event) =>
                  dispatch({
                    type: 'undescribed',
                    commitId: commit.commitId,
                    selected: event.target.checked,
                  })
                }
              />
            </td>
            <td>
              <button
                type="button"
                className="cleanup-file"
                aria-expanded={expanded.has(commit.commitId)}
                onClick={() => onToggleFiles(commit.commitId)}
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
  const send = useSend<CleanupWebviewMessage>()
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
