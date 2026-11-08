import type { ShellInbound } from '../../shared/desktopProtocol'
import type { PanelChannel, PanelHandler } from '../app/panel'
import { errorMessage, type Logger } from '../util/logger'
import type { PanelEntry } from './workbench'

interface Tab {
  receive: (message: unknown) => void
  closed: () => void
}

function isMessage(value: unknown): value is { type: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

// The Split and Clean up tabs next to the change details. Their messages travel wrapped, so
// several tabs and the graph share the window's channel.
export class PanelTabs {
  private readonly tabs = new Map<string, Tab>()
  // Tab ids by the key their opener gave, for tabs that open once.
  private readonly keys = new Map<string, string>()
  private next = 1

  constructor(
    private readonly post: (message: ShellInbound) => void,
    private readonly logger: Logger,
  ) {}

  open<H, W>(
    entry: PanelEntry,
    title: string,
    connect: (channel: PanelChannel<H>) => PanelHandler<W>,
    key?: string,
  ): void {
    const known = key ? this.keys.get(key) : undefined
    if (known && this.tabs.has(known)) {
      this.post({ type: 'desktop.tabOpen', tab: { id: known, kind: entry, title } })
      return
    }
    const id = `${entry}-${this.next++}`
    if (key) {
      this.keys.set(key, id)
    }
    let closed = false
    const channel: PanelChannel<H> = {
      post: async (message) => {
        if (!closed) {
          this.post({ type: 'desktop.panel', panelId: id, message })
        }
      },
      close: () => {
        if (!closed) {
          closed = true
          this.tabs.delete(id)
          this.post({ type: 'desktop.tabClose', id })
        }
      },
      get isClosed() {
        return closed
      },
    }
    const handler = connect(channel)
    this.tabs.set(id, {
      receive: (message) => {
        if (isMessage(message)) {
          void handler(message as W).catch((error: unknown) =>
            this.logger.error(`${entry} message failed: ${errorMessage(error)}`),
          )
        }
      },
      closed: () => {
        closed = true
      },
    })
    this.post({ type: 'desktop.tabOpen', tab: { id, kind: entry, title } })
  }

  // A message from the view in the tab `id`.
  receive(id: string, message: unknown): void {
    this.tabs.get(id)?.receive(message)
  }

  // The user closed the tab in the window.
  closedInWindow(id: string): void {
    const tab = this.tabs.get(id)
    this.tabs.delete(id)
    tab?.closed()
    this.post({ type: 'desktop.tabClose', id })
  }

  // The page went away, and the state of its tabs with it.
  closeAll(): void {
    for (const tab of this.tabs.values()) {
      tab.closed()
    }
    this.tabs.clear()
    this.keys.clear()
  }
}
