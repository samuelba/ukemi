import type { DesktopRendererMessage, FontSpec, LogLine } from '../../../shared/desktopProtocol'
import { postMessage } from '../shared/hostApi'
import { LogPanel } from './LogPanel'
import { TerminalView } from './TerminalView'

export const LOG_TAB = 'log'

export interface TerminalTab {
  id: string
  title: string
  cwd: string
  hasExited: boolean
}

function send(message: DesktopRendererMessage): void {
  postMessage(message)
}

// The panel under the graph: terminals and the log, as tabs.
export function BottomPanel({
  terminals,
  active,
  log,
  font,
  onActivate,
  onCloseTerminal,
  onHide,
}: {
  terminals: readonly TerminalTab[]
  active: string
  log: readonly LogLine[]
  font: FontSpec
  onActivate: (id: string) => void
  onCloseTerminal: (id: string) => void
  onHide: () => void
}) {
  return (
    <section className="bottom-panel" aria-label="Panel">
      <div className="bottom-tabs" role="tablist">
        {terminals.map((terminal) => (
          <div
            key={terminal.id}
            role="tab"
            aria-selected={terminal.id === active}
            title={terminal.cwd}
            className={`pane-tab bottom-tab${terminal.id === active ? ' is-active' : ''}${terminal.hasExited ? ' has-exited' : ''}`}
            onClick={() => onActivate(terminal.id)}
            onAuxClick={(e) => e.button === 1 && onCloseTerminal(terminal.id)}
          >
            <span className="codicon codicon-terminal" aria-hidden />
            <span className="pane-tab-label">{terminal.title}</span>
            <button
              className="repo-tab-close"
              aria-label={`Close terminal ${terminal.title}`}
              onClick={(e) => {
                e.stopPropagation()
                onCloseTerminal(terminal.id)
              }}
            >
              <span className="codicon codicon-close" aria-hidden />
            </button>
          </div>
        ))}
        <button
          className="icon-button"
          title="New terminal"
          aria-label="New terminal"
          onClick={() => send({ type: 'desktop.terminalCreate' })}
        >
          <span className="codicon codicon-add" aria-hidden />
        </button>
        <div
          role="tab"
          aria-selected={active === LOG_TAB}
          className={`pane-tab bottom-tab bottom-tab-log${active === LOG_TAB ? ' is-active' : ''}`}
          onClick={() => onActivate(LOG_TAB)}
        >
          <span className="codicon codicon-output" aria-hidden />
          <span className="pane-tab-label">Log</span>
        </div>
        <span className="titlebar-spacer" />
        <button
          className="icon-button"
          title="Hide the panel"
          aria-label="Hide the panel"
          onClick={onHide}
        >
          <span className="codicon codicon-chevron-down" aria-hidden />
        </button>
      </div>
      <div className="bottom-body">
        {terminals.map((terminal) => (
          <TerminalView
            key={terminal.id}
            id={terminal.id}
            isVisible={terminal.id === active}
            font={font}
          />
        ))}
        {active === LOG_TAB && <LogPanel lines={log} />}
      </div>
    </section>
  )
}
