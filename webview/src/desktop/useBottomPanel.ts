import { useCallback, useState } from 'react'
import type { DesktopRendererMessage, LogLine } from '../../../shared/desktopProtocol'
import { postMessage } from '../shared/hostApi'
import { LOG_TAB, type TerminalTab } from './BottomPanel'
import { appendLog, withExitedTerminal, withoutTab } from './shellState'
import type { Layout, UpdateLayout } from './useLayout'

// The bottom panel: its terminals, the log, and which of them shows.
export function useBottomPanel(layout: Layout, update: UpdateLayout) {
  const [log, setLog] = useState<readonly LogLine[]>([])
  const [terminals, setTerminals] = useState<readonly TerminalTab[]>([])
  const [panelTab, setPanelTab] = useState(LOG_TAB)

  const show = useCallback(
    (id: string) => {
      setPanelTab(id)
      update({ showPanel: true })
    },
    [update],
  )
  const showLog = useCallback(() => show(LOG_TAB), [show])

  return {
    log,
    terminals,
    panelTab,
    setPanelTab,
    showLog,
    addLog: (lines: readonly LogLine[], replace: boolean) =>
      setLog((all) => appendLog(all, lines, replace)),
    terminalOpened: (terminal: Omit<TerminalTab, 'hasExited'>) => {
      setTerminals((all) => [...all, { ...terminal, hasExited: false }])
      show(terminal.id)
    },
    terminalExited: (id: string) => setTerminals((all) => withExitedTerminal(all, id)),
    toggleLog: () => {
      if (layout.showPanel && panelTab === LOG_TAB) {
        update({ showPanel: false })
      } else {
        showLog()
      }
    },
    // Shows the terminal, starting one when there is none. Hides the panel when a terminal shows.
    toggleTerminal: () => {
      if (layout.showPanel && terminals.some((t) => t.id === panelTab)) {
        update({ showPanel: false })
        return
      }
      const last = terminals.at(-1)
      if (last) {
        show(last.id)
      } else {
        postMessage<DesktopRendererMessage>({ type: 'desktop.terminalCreate' })
      }
    },
    closeTerminal: (id: string) => {
      postMessage<DesktopRendererMessage>({ type: 'desktop.terminalClose', id })
      const rest = withoutTab(terminals, id)
      setTerminals(rest)
      if (panelTab === id) {
        setPanelTab(rest.at(-1)?.id ?? LOG_TAB)
      }
    },
  }
}
