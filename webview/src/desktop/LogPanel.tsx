import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react'
import type { DesktopRendererMessage, LogLine } from '../../../shared/desktopProtocol'
import { postMessage } from '../shared/hostApi'

function send(message: DesktopRendererMessage): void {
  postMessage(message)
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour12: false })
}

// Copies the selected lines as "time level message", one per line. The browser would put each
// grid column on its own line. A selection inside one column copies as the browser does it.
function copyLines(event: ClipboardEvent<HTMLDivElement>): void {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return
  }
  const range = selection.getRangeAt(0)
  const common = range.commonAncestorContainer
  const within = common instanceof Element ? common : common.parentElement
  if (within?.closest('.log-line > span')) {
    return
  }
  // A selection that ends where the next line starts does not take that line.
  const picked = [...event.currentTarget.querySelectorAll('.log-line')].filter((line) => {
    const contents = document.createRange()
    contents.selectNodeContents(line)
    return (
      range.compareBoundaryPoints(Range.START_TO_END, contents) > 0 &&
      range.compareBoundaryPoints(Range.END_TO_START, contents) < 0
    )
  })
  if (picked.length === 0) {
    return
  }
  const text = picked
    .map((line) => [...line.children].map((cell) => cell.textContent ?? '').join(' '))
    .join('\n')
  event.clipboardData.setData('text/plain', text)
  event.preventDefault()
}

// The app's log, like the Output panel of VS Code: every jj call and what went wrong.
export function LogPanel({ lines }: { lines: readonly LogLine[] }) {
  const [filter, setFilter] = useState('')
  const [onlyProblems, setOnlyProblems] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return lines.filter(
      (line) =>
        (!onlyProblems || line.level !== 'info') &&
        (!needle || line.message.toLowerCase().includes(needle)),
    )
  }, [lines, filter, onlyProblems])

  // Follows new lines while the view is at the bottom, like a terminal.
  useLayoutEffect(() => {
    const element = body.current
    if (element && stick.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [visible])
  useEffect(() => {
    stick.current = true
  }, [filter, onlyProblems])

  return (
    <section className="log-panel" aria-label="Log">
      <header className="log-header">
        <div className="side-filter log-filter">
          <span className="codicon codicon-filter" aria-hidden />
          <input
            value={filter}
            placeholder="Filter"
            spellCheck={false}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <button
          className={`button-quiet${onlyProblems ? ' is-on' : ''}`}
          aria-pressed={onlyProblems}
          onClick={() => setOnlyProblems((v) => !v)}
        >
          Problems only
        </button>
        <span className="titlebar-spacer" />
        <button
          className="icon-button"
          title="Open the log file"
          onClick={() => send({ type: 'desktop.openLogFile' })}
        >
          <span className="codicon codicon-go-to-file" aria-hidden />
        </button>
        <button
          className="icon-button"
          title="Clear"
          onClick={() => send({ type: 'desktop.clearLog' })}
        >
          <span className="codicon codicon-clear-all" aria-hidden />
        </button>
      </header>
      <div
        className="log-body"
        ref={body}
        onCopy={copyLines}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {visible.map((line, index) => (
          <div key={index} className={`log-line log-${line.level}`}>
            <span className="log-time">{clock(line.time)}</span>
            <span className="log-level">{line.level === 'warning' ? 'warn' : line.level}</span>
            <span className="log-message">{line.message}</span>
          </div>
        ))}
        {visible.length === 0 && (
          <p className="side-empty">
            {lines.length === 0 ? 'Nothing logged yet.' : 'No lines match.'}
          </p>
        )}
      </div>
    </section>
  )
}
