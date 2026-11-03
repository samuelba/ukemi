import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { DesktopHostMessage } from '../../shared/desktopProtocol'
import { Terminals } from '../../src/desktop/terminals'
import type { Logger } from '../../src/util/logger'

const spawned = vi.hoisted(() => [] as { kill: () => void }[])

vi.mock('node-pty', () => ({
  spawn: () => {
    const child = { onData: () => undefined, onExit: () => undefined, kill: vi.fn() }
    spawned.push(child)
    return child
  },
}))

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger

function openTerminal(): { terminals: Terminals; id: string } {
  const sent: DesktopHostMessage[] = []
  const terminals = new Terminals((message) => sent.push(message), logger)
  terminals.open('/tmp', 'repo')
  const opened = sent.find((message) => message.type === 'desktop.terminalOpen')
  if (opened?.type !== 'desktop.terminalOpen') {
    throw new Error('no terminal opened')
  }
  return { terminals, id: opened.id }
}

beforeEach(() => {
  spawned.length = 0
})

describe('Terminals', () => {
  test('starts one shell when the view sends its size twice', async () => {
    const { terminals, id } = openTerminal()
    await Promise.all([terminals.start(id, 80, 24), terminals.start(id, 80, 24)])
    expect(spawned).toHaveLength(1)
    terminals.dispose()
    expect(spawned[0]?.kill).toHaveBeenCalled()
  })

  test('starts no shell for a tab that closed while node-pty loaded', async () => {
    const { terminals, id } = openTerminal()
    const starting = terminals.start(id, 80, 24)
    terminals.close(id)
    await starting
    expect(spawned).toHaveLength(0)
  })
})
