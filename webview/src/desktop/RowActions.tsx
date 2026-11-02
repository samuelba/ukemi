import type { MouseEvent } from 'react'
import type { DesktopRendererMessage, SidePanelRow } from '../../../shared/desktopProtocol'
import { postMessage } from '../shared/hostApi'

function send(message: DesktopRendererMessage): void {
  postMessage(message)
}

export function openRowMenu(row: SidePanelRow, event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()
  send({ type: 'desktop.rowMenu', row, x: event.clientX, y: event.clientY })
}

// The hover buttons of a row, as VS Code shows them on a tree item, then the full menu.
export function RowActions({ row }: { row: SidePanelRow }) {
  return (
    <span className="row-actions">
      {(row.inline ?? []).map((action) => (
        <button
          key={action.command}
          className="icon-button"
          title={action.title}
          aria-label={`${action.title}: ${row.label}`}
          onClick={(event) => {
            event.stopPropagation()
            send({ type: 'desktop.run', command: action.command, arg: row.arg })
          }}
        >
          <span className={`codicon codicon-${action.icon ?? 'circle-small-filled'}`} aria-hidden />
        </button>
      ))}
      <button
        className="icon-button"
        title="More actions"
        aria-label={`More actions for ${row.label}`}
        onClick={(event) => openRowMenu(row, event)}
      >
        <span className="codicon codicon-ellipsis" aria-hidden />
      </button>
    </span>
  )
}
