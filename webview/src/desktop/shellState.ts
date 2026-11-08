import type { ChangeDetail, DiffDocument, LogLine, PanelTab } from '../../../shared/desktopProtocol'
import type { TerminalTab } from './BottomPanel'

// The pure steps of the shell's state, kept apart from React so they can be tested.

export const LOG_LIMIT = 5_000

export function appendLog(
  all: readonly LogLine[],
  lines: readonly LogLine[],
  replace: boolean,
  limit = LOG_LIMIT,
): readonly LogLine[] {
  return (replace ? lines : [...all, ...lines]).slice(-limit)
}

// An id that is already open is shown again, with its new title.
export function withTab(tabs: readonly PanelTab[], tab: PanelTab): readonly PanelTab[] {
  return tabs.some((t) => t.id === tab.id)
    ? tabs.map((t) => (t.id === tab.id ? tab : t))
    : [...tabs, tab]
}

export function withoutTab<T extends { id: string }>(tabs: readonly T[], id: string): readonly T[] {
  return tabs.filter((tab) => tab.id !== id)
}

export function withExitedTerminal(
  terminals: readonly TerminalTab[],
  id: string,
): readonly TerminalTab[] {
  return terminals.map((t) => (t.id === id ? { ...t, hasExited: true } : t))
}

// The tab that shows once `closed` is gone: the same one, or `fallback` if it was the one closed.
export function activeAfterClose(active: string, closed: string, fallback: string): string {
  return active === closed ? fallback : active
}

export interface DetailPane {
  detail: ChangeDetail | null
  diff: DiffDocument | null
}

// A diff belongs to its change, so another change closes it.
export function withDetail(pane: DetailPane, detail: ChangeDetail | null): DetailPane {
  const isSameChange = detail?.commit.changeId === pane.detail?.commit.changeId
  return { detail, diff: isSameChange ? pane.diff : null }
}
