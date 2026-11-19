import { describe, expect, test } from 'vitest'
import {
  canFallBackToX11,
  relaunchExecutable,
  X11_SWITCH,
  x11Args,
} from '../../src/desktop/windowSystem'

const WAYLAND = { WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }

describe('canFallBackToX11', () => {
  test('applies to a Wayland session that also has XWayland', () => {
    expect(canFallBackToX11('linux', WAYLAND, [])).toBe(true)
  })

  test('does not apply without Wayland or without an X server to fall back to', () => {
    expect(canFallBackToX11('linux', { DISPLAY: ':0' }, [])).toBe(false)
    expect(canFallBackToX11('linux', { WAYLAND_DISPLAY: 'wayland-0' }, [])).toBe(false)
  })

  test('does not apply outside Linux', () => {
    expect(canFallBackToX11('darwin', WAYLAND, [])).toBe(false)
  })

  test('does not apply in Flatpak, whose X11 socket is missing on Wayland', () => {
    expect(canFallBackToX11('linux', { ...WAYLAND, FLATPAK_ID: 'dev.samuelba.ukemi' }, [])).toBe(
      false,
    )
  })

  test('leaves a platform chosen on the command line alone', () => {
    expect(canFallBackToX11('linux', WAYLAND, ['--ozone-platform=wayland'])).toBe(false)
    expect(canFallBackToX11('linux', WAYLAND, ['--ozone-platform', 'x11'])).toBe(false)
    expect(canFallBackToX11('linux', WAYLAND, ['--ozone-platform-hint=auto'])).toBe(false)
    expect(canFallBackToX11('linux', WAYLAND, ['--ozone-platformish'])).toBe(true)
  })
})

describe('x11Args', () => {
  test('keeps the original arguments and adds the X11 switch', () => {
    expect(x11Args(['.', '--verbose'])).toEqual(['.', '--verbose', X11_SWITCH])
  })
})

describe('relaunchExecutable', () => {
  test('restarts an AppImage from its file, since its mount goes away on exit', () => {
    expect(relaunchExecutable({ APPIMAGE: '/home/u/Ukemi.AppImage' }, '/tmp/.mount_x/ukemi')).toBe(
      '/home/u/Ukemi.AppImage',
    )
  })

  test('restarts any other install from its own program', () => {
    expect(relaunchExecutable({}, '/opt/Ukemi/ukemi')).toBe('/opt/Ukemi/ukemi')
  })
})
