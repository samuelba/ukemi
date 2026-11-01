import { useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  DesktopRendererMessage,
  SidePanelRow,
  SidePanels,
} from '../../../shared/desktopProtocol'
import { postMessage } from '../shared/hostApi'
import { openRowMenu, RowActions } from './RowActions'
import { Splitter } from './Splitter'

const SHARE_KEY = 'ukemi.sidebar.workspacesShare'
const DEFAULT_SHARE = 0.3
const MIN_SHARE = 0.1
const MAX_SHARE = 0.9

// The part of the sidebar's height that Workspaces takes while both sections are open.
function readShare(): number {
  try {
    const saved = Number(localStorage.getItem(SHARE_KEY))
    return saved >= MIN_SHARE && saved <= MAX_SHARE ? saved : DEFAULT_SHARE
  } catch {
    return DEFAULT_SHARE
  }
}

function saveShare(share: number | null): void {
  try {
    if (share === null) {
      localStorage.removeItem(SHARE_KEY)
    } else {
      localStorage.setItem(SHARE_KEY, String(share))
    }
  } catch {
    // The split is a convenience only.
  }
}

function runDefault(row: SidePanelRow): void {
  if (row.defaultCommand) {
    postMessage<DesktopRendererMessage>({
      type: 'desktop.run',
      command: row.defaultCommand,
      arg: row.arg,
    })
  }
}

function Row({ row }: { row: SidePanelRow }) {
  return (
    <li
      className="side-row"
      title={row.tooltip}
      tabIndex={0}
      onDoubleClick={() => runDefault(row)}
      onKeyDown={(e) => e.key === 'Enter' && runDefault(row)}
      onContextMenu={(e) => openRowMenu(row, e)}
    >
      <span className={`codicon codicon-${row.icon} side-row-icon`} aria-hidden />
      <span className="side-row-label">{row.label}</span>
      {row.description && <span className="side-row-description">{row.description}</span>}
      <RowActions row={row} />
    </li>
  )
}

// A header that stays put, an optional toolbar under it, and a body that scrolls on its own.
function Section({
  title,
  count,
  isOpen,
  onToggle,
  children,
  toolbar,
  actions,
}: {
  title: string
  count: number
  isOpen: boolean
  onToggle: () => void
  children: ReactNode
  toolbar?: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="side-section" data-open={isOpen} aria-label={title}>
      <header className="side-section-header">
        <button className="side-section-toggle" onClick={onToggle}>
          <span className={`codicon codicon-chevron-${isOpen ? 'down' : 'right'}`} aria-hidden />
          <span className="side-section-title">{title}</span>
          <span className="side-section-count">{count}</span>
        </button>
        {actions}
      </header>
      {isOpen && toolbar}
      {isOpen && <div className="side-section-body">{children}</div>}
    </section>
  )
}

// Bookmarks and workspaces of the active repository, as the VS Code sidebar views list them.
export function Sidebar({ panels }: { panels: SidePanels }) {
  const [filter, setFilter] = useState('')
  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return panels.bookmarks
      .map((group) => ({
        ...group,
        rows: needle
          ? group.rows.filter((row) => row.label.toLowerCase().includes(needle))
          : group.rows,
      }))
      .filter((group) => group.rows.length > 0 || !needle)
  }, [panels.bookmarks, filter])
  const bookmarkCount = panels.bookmarks.reduce((sum, group) => sum + group.rows.length, 0)
  const [showBookmarks, setShowBookmarks] = useState(true)
  const [showWorkspaces, setShowWorkspaces] = useState(true)
  const [share, setShare] = useState(readShare)
  const aside = useRef<HTMLElement>(null)

  const resize = (delta: number) => {
    const height = aside.current?.clientHeight ?? 1
    setShare((current) => {
      const next = Math.min(MAX_SHARE, Math.max(MIN_SHARE, current - delta / height))
      saveShare(next)
      return next
    })
  }

  // A closed section shrinks to its header, and the open one takes the rest.
  const isSplit = showBookmarks && showWorkspaces
  const rows = isSplit
    ? `minmax(0, ${1 - share}fr) 1px minmax(0, ${share}fr)`
    : `${showBookmarks ? 'minmax(0, 1fr)' : 'auto'} ${showWorkspaces ? 'minmax(0, 1fr)' : 'auto'}`

  return (
    <aside
      ref={aside}
      className="sidebar"
      aria-label="Bookmarks and workspaces"
      data-split={isSplit || undefined}
      style={{ gridTemplateRows: rows }}
    >
      <Section
        title="Bookmarks"
        count={bookmarkCount}
        isOpen={showBookmarks}
        onToggle={() => setShowBookmarks((v) => !v)}
        toolbar={
          <div className="side-filter">
            <span className="codicon codicon-filter" aria-hidden />
            <input
              value={filter}
              placeholder="Filter bookmarks"
              spellCheck={false}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
            />
          </div>
        }
      >
        {groups.map((group) => (
          <div key={group.id} className="side-group">
            <h3 className="side-group-title">
              <span className={`codicon codicon-${group.icon}`} aria-hidden />
              {group.label}
            </h3>
            <ul className="side-rows">
              {group.rows.map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </ul>
          </div>
        ))}
        {bookmarkCount === 0 && <p className="side-empty">No bookmarks yet.</p>}
        {bookmarkCount > 0 && groups.length === 0 && (
          <p className="side-empty">No bookmarks match “{filter.trim()}”.</p>
        )}
      </Section>
      {isSplit && (
        <Splitter
          label="Resize bookmarks and workspaces"
          direction="rows"
          onDrag={resize}
          onReset={() => {
            saveShare(null)
            setShare(DEFAULT_SHARE)
          }}
        />
      )}
      <Section
        title="Workspaces"
        count={panels.workspaces.length}
        isOpen={showWorkspaces}
        onToggle={() => setShowWorkspaces((v) => !v)}
        actions={
          <button
            className="icon-button"
            aria-label="Add workspace"
            title="Add workspace"
            onClick={() =>
              postMessage<DesktopRendererMessage>({
                type: 'desktop.run',
                command: 'ukemi.addWorkspace',
              })
            }
          >
            <span className="codicon codicon-add" aria-hidden />
          </button>
        }
      >
        <ul className="side-rows">
          {panels.workspaces.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </ul>
      </Section>
    </aside>
  )
}
