import { useMemo, useState } from 'react'
import type {
  DesktopRendererMessage,
  SidePanelRow,
  SidePanels,
} from '../../../shared/desktopProtocol'
import { postMessage } from '../shared/hostApi'
import { openRowMenu, RowActions } from './RowActions'

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

function Section({
  title,
  count,
  children,
  actions,
}: {
  title: string
  count: number
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(true)
  return (
    <section className="side-section" data-open={isOpen}>
      <header className="side-section-header">
        <button className="side-section-toggle" onClick={() => setIsOpen((v) => !v)}>
          <span className={`codicon codicon-chevron-${isOpen ? 'down' : 'right'}`} aria-hidden />
          <span className="side-section-title">{title}</span>
          <span className="side-section-count">{count}</span>
        </button>
        {actions}
      </header>
      {isOpen && children}
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

  return (
    <aside className="sidebar" aria-label="Bookmarks and workspaces">
      <Section title="Bookmarks" count={bookmarkCount}>
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
      <Section
        title="Workspaces"
        count={panels.workspaces.length}
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
