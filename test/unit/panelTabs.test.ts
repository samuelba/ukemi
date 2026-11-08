import { describe, expect, test } from 'vitest'
import type { ShellInbound } from '../../shared/desktopProtocol'
import type { PanelChannel } from '../../src/app/panel'
import { PanelTabs } from '../../src/desktop/panelTabs'
import { NULL_LOGGER } from '../../src/util/logger'

function setup() {
  const posted: ShellInbound[] = []
  const tabs = new PanelTabs((message) => posted.push(message), NULL_LOGGER)
  const received: unknown[] = []
  let channel: PanelChannel<unknown> | undefined
  const open = (key?: string) =>
    tabs.open(
      'split',
      'Split',
      (c) => {
        channel = c
        return async (message: unknown) => {
          received.push(message)
        }
      },
      key,
    )
  return { tabs, posted, received, open, channel: () => channel! }
}

describe('PanelTabs', () => {
  test('a tab opened again by its key shows the same tab', () => {
    const { posted, open } = setup()
    open('split:a')
    open('split:a')
    const opened = posted.filter((m) => m.type === 'desktop.tabOpen')
    expect(opened.map((m) => m.type === 'desktop.tabOpen' && m.tab.id)).toEqual([
      'split-1',
      'split-1',
    ])
  })

  test('routes messages to the tab and drops ones without a type', () => {
    const { tabs, received, open } = setup()
    open()
    tabs.receive('split-1', { type: 'apply' })
    tabs.receive('split-1', 'junk')
    tabs.receive('split-9', { type: 'apply' })
    expect(received).toEqual([{ type: 'apply' }])
  })

  test('a tab closed in the window stops posting', async () => {
    const { tabs, posted, open, channel } = setup()
    open()
    tabs.closedInWindow('split-1')
    await channel().post({ type: 'load' })
    expect(channel().isClosed).toBe(true)
    expect(posted.some((m) => m.type === 'desktop.panel')).toBe(false)
    expect(posted.at(-1)).toEqual({ type: 'desktop.tabClose', id: 'split-1' })
  })

  test('closing every tab forgets the keys, so the key opens a new tab', () => {
    const { tabs, posted, open, channel } = setup()
    open('split:a')
    const first = channel()
    tabs.closeAll()
    expect(first.isClosed).toBe(true)
    open('split:a')
    const last = posted.at(-1)
    expect(last?.type === 'desktop.tabOpen' && last.tab.id).toBe('split-2')
  })
})
