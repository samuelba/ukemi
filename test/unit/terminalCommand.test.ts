import { describe, expect, test } from 'vitest'
import { terminalCommand } from '../../src/desktop/terminalCommand'

describe('terminalCommand', () => {
  test("starts the user's shell in the folder on Linux", () => {
    const command = terminalCommand('linux', { SHELL: '/usr/bin/zsh', HOME: '/home/u' }, '/repo')
    expect(command).toMatchObject({ file: '/usr/bin/zsh', args: [], cwd: '/repo' })
    expect(command.env).toMatchObject({ TERM: 'xterm-256color', COLORTERM: 'truecolor' })
  })

  test('starts a login shell on macOS, as Terminal.app does', () => {
    expect(terminalCommand('darwin', { SHELL: '/bin/zsh' }, '/repo')).toMatchObject({
      file: '/bin/zsh',
      args: ['-l'],
    })
  })

  test('falls back to bash without SHELL, and to PowerShell on Windows', () => {
    expect(terminalCommand('linux', {}, '/repo').file).toBe('/bin/bash')
    expect(terminalCommand('win32', {}, 'C:\\repo').file).toBe('powershell.exe')
  })

  test("keeps the app's own variables out of the shell", () => {
    const env = {
      SHELL: '/bin/bash',
      ELECTRON_RUN_AS_NODE: '1',
      UKEMI_USER_DATA: '/x',
      PATH: '/usr/bin',
    }
    const command = terminalCommand('linux', env, '/repo')
    expect(command.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(command.env.UKEMI_USER_DATA).toBeUndefined()
    expect(command.env.PATH).toBe('/usr/bin')
  })

  test("runs the host's shell from a Flatpak", () => {
    const command = terminalCommand(
      'linux',
      { FLATPAK_ID: 'dev.samuelba.ukemi', SHELL: '/bin/sh' },
      '/repo',
    )
    expect(command.file).toBe('flatpak-spawn')
    expect(command.args).toEqual([
      '--host',
      '--watch-bus',
      '--directory=/repo',
      '--env=TERM=xterm-256color',
      '--env=COLORTERM=truecolor',
      'sh',
      '-c',
      'exec "${SHELL:-/bin/bash}" -l',
    ])
  })
})
