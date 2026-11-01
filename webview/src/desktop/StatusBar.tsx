import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import type { DesktopRendererMessage } from '../../../shared/desktopProtocol'
import type { HostMessage, ViewState } from '../../../shared/protocol'
import { summarizeStatus, type StatusAction, type StatusItem } from '../../../shared/statusSummary'
import { postMessage } from '../shared/hostApi'

// Keeps "Fetched 3m ago" current between state updates.
const TICK_MS = 30_000

interface StatusBarProps {
  state: ViewState | null
  onShowLog: () => void
}

// Handled by the graph like a message from the host, so it needs no round trip.
function reveal(commitId: string): void {
  const data: HostMessage = { type: 'reveal', commitId }
  window.dispatchEvent(new MessageEvent('message', { data }))
}

function run(command: string, arg?: unknown): void {
  postMessage<DesktopRendererMessage>({ type: 'desktop.run', command, arg })
}

function perform(
  action: StatusAction,
  state: ViewState,
  event: MouseEvent<HTMLButtonElement>,
  onShowLog: () => void,
): void {
  switch (action.kind) {
    case 'reveal':
      reveal(action.commitId)
      return
    case 'resolve':
      reveal(action.commitId)
      run('ukemi.conflict.resolve', { repoId: state.graph?.repoId, commitId: action.commitId })
      return
    case 'bookmarkMenu': {
      const box = event.currentTarget.getBoundingClientRect()
      postMessage<DesktopRendererMessage>({
        type: 'desktop.contextMenu',
        context: action.context,
        x: box.left,
        y: box.top,
      })
      return
    }
    case 'command':
      run(action.command)
      return
    case 'openUrl':
      postMessage<DesktopRendererMessage>({ type: 'desktop.openExternal', url: action.url })
      return
    case 'showLog':
      onShowLog()
      return
  }
}

interface ItemProps {
  item: StatusItem
  state: ViewState
  onShowLog: () => void
}

function Item({ item, state, onShowLog }: ItemProps) {
  const spin = item.isSpinning ? ' codicon-modifier-spin' : ''
  const content = (
    <>
      <span className={`codicon codicon-${item.icon}${spin}`} aria-hidden />
      {item.code && <span className="status-code">{item.code}</span>}
      {item.text && <span className="status-text">{item.text}</span>}
    </>
  )
  const className = `status-item status-${item.id} tone-${item.tone}`
  const { action } = item
  if (!action) {
    return (
      <span className={className} title={item.tooltip}>
        {content}
      </span>
    )
  }
  return (
    <button
      className={className}
      title={item.tooltip}
      // Right-clicking the bookmark gives the same menu as its badge in the graph.
      data-vscode-context={
        action.kind === 'bookmarkMenu' ? JSON.stringify(action.context) : undefined
      }
      onClick={(event) => perform(action, state, event, onShowLog)}
    >
      {content}
    </button>
  )
}

export function StatusBar({ state, onShowLog }: StatusBarProps) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => clearInterval(timer)
  }, [])
  // The tick only re-reads the clock, for "Fetched 3m ago".
  const items = useMemo(() => (state ? summarizeStatus(state, Date.now()) : []), [state, tick])
  const error = items.find((item) => item.id === 'error')
  const group = (side: StatusItem['side']) =>
    state &&
    items
      .filter((item) => item.side === side)
      .map((item) => <Item key={item.id} item={item} state={state} onShowLog={onShowLog} />)
  return (
    <footer className="status-bar" aria-label="Repository status">
      <div className="status-group status-left">{group('left')}</div>
      <div className="status-group status-right">{group('right')}</div>
      {/* Only errors are announced. The rest changes too often to read out. */}
      <span className="status-announce" role="alert">
        {error?.text}
      </span>
    </footer>
  )
}
