import { describe, expect, test, vi } from 'vitest'
import {
  COPY_UPDATE_COMMAND,
  UpdateInstaller,
  type UpdateHost,
  type UpdateWindow,
} from '../../src/desktop/updateInstaller'

function fakeWindow(answer?: string): UpdateWindow & { titles: string[]; shown: string[][] } {
  const titles: string[] = []
  const shown: string[][] = []
  return {
    titles,
    shown,
    progress: (title, task) => {
      titles.push(title)
      return task()
    },
    notify: (text, ...actions) => {
      shown.push([text, ...actions])
      return Promise.resolve(answer)
    },
  }
}

function fakeHost(window: UpdateWindow | undefined, overrides: Partial<UpdateHost> = {}) {
  return {
    currentWindow: vi.fn(() => window),
    install: vi.fn(() => Promise.resolve()),
    copyCommand: vi.fn(),
    restart: vi.fn(),
    logFailure: vi.fn(),
    ...overrides,
  }
}

describe('UpdateInstaller', () => {
  test('shows progress for the whole install, then offers a restart', async () => {
    const window = fakeWindow('Restart')
    const host = fakeHost(window)
    await new UpdateInstaller(host).run(window, '1.2.3')
    expect(window.titles).toEqual(['Updating Ukemi to 1.2.3…'])
    expect(host.install).toHaveBeenCalledWith('1.2.3')
    expect(window.shown).toEqual([['Ukemi 1.2.3 is installed.', 'Restart']])
    expect(host.restart).toHaveBeenCalledOnce()
  })

  test('does not restart until asked', async () => {
    const window = fakeWindow()
    const host = fakeHost(window)
    await new UpdateInstaller(host).run(window, '1.2.3')
    expect(host.restart).not.toHaveBeenCalled()
  })

  test('reports a failure and can copy the update command', async () => {
    const window = fakeWindow(COPY_UPDATE_COMMAND)
    const install = vi.fn(() => Promise.reject(new Error('not signed')))
    const host = fakeHost(window, { install })
    await new UpdateInstaller(host).run(window, '1.2.3')
    expect(host.logFailure).toHaveBeenCalledWith('1.2.3', 'not signed')
    expect(window.shown).toEqual([['Ukemi was not updated: not signed', COPY_UPDATE_COMMAND]])
    expect(host.copyCommand).toHaveBeenCalledOnce()
    expect(host.restart).not.toHaveBeenCalled()
  })

  test('ignores a second update while one is running', async () => {
    const window = fakeWindow()
    let finish = (): void => undefined
    const install = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const installer = new UpdateInstaller(fakeHost(window, { install }))
    const first = installer.run(window, '1.2.3')
    await installer.run(window, '1.2.3')
    expect(install).toHaveBeenCalledOnce()
    finish()
    await first
  })

  test('an unanswered failure message does not block a retry', async () => {
    const window = fakeWindow()
    const notified = vi.fn()
    window.notify = () => {
      notified()
      return new Promise(() => undefined)
    }
    const install = vi.fn(() => Promise.reject(new Error('offline')))
    const installer = new UpdateInstaller(fakeHost(window, { install }))
    void installer.run(window, '1.2.3')
    await vi.waitFor(() => expect(notified).toHaveBeenCalledTimes(1))
    void installer.run(window, '1.2.3')
    await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(2))
  })

  test('sends the result to a window that is still open', async () => {
    const closed = fakeWindow()
    const open = fakeWindow()
    await new UpdateInstaller(fakeHost(open)).run(closed, '1.2.3')
    expect(closed.shown).toEqual([])
    expect(open.shown).toEqual([['Ukemi 1.2.3 is installed.', 'Restart']])
  })

  test('still logs a failure when no window is left', async () => {
    const closed = fakeWindow()
    const install = vi.fn(() => Promise.reject(new Error('offline')))
    const host = fakeHost(undefined, { install })
    await new UpdateInstaller(host).run(closed, '1.2.3')
    expect(host.logFailure).toHaveBeenCalledWith('1.2.3', 'offline')
    expect(closed.shown).toEqual([])
  })
})
