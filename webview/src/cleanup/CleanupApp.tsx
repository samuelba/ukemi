import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type {
  CleanupDivergence,
  CleanupHostMessage,
  CleanupRevision,
  CleanupSelection,
  CleanupSnapshot,
  CleanupWebviewMessage,
} from '../../../shared/cleanup'
import { postMessage } from '../shared/vscodeApi'

const send = (message: CleanupWebviewMessage) => postMessage(message)

function isEmpty(snapshot: CleanupSnapshot): boolean {
  return (
    snapshot.bookmarks.length === 0 &&
    snapshot.workspaces.length === 0 &&
    snapshot.divergent.length === 0
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
  const [workspaces, setWorkspaces] = useState<ReadonlySet<string>>(new Set())
  const [drops, setDrops] = useState<ReadonlySet<string>>(new Set())
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
      if (event.data.type !== 'load') {
        return
      }
      const next = event.data.snapshot
      setSnapshot(next)
      setBookmarks(
        new Set(next.bookmarks.filter((bookmark) => bookmark.checked).map((b) => b.name)),
      )
      setWorkspaces(
        new Set(next.workspaces.filter((workspace) => workspace.checked).map((w) => w.name)),
      )
      setDrops(initialDrops(next))
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

  const count = bookmarks.size + workspaces.size + drops.size
  const selection: CleanupSelection = {
    bookmarks: [...bookmarks],
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
