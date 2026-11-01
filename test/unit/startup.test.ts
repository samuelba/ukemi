import { describe, expect, test } from 'vitest'
import {
  desktopFileName,
  startupWindows,
  themeSource,
  windowsToRemember,
} from '../../src/desktop/startup'

const all = () => true

describe('startupWindows', () => {
  test('opens the folders from the command line, whatever was open before', () => {
    expect(startupWindows(['/a'], [['/b']], true, all)).toEqual([['/a']])
  })

  test('reopens the last windows with their repositories', () => {
    expect(startupWindows([], [['/a', '/b'], ['/c']], true, all)).toEqual([['/a', '/b'], ['/c']])
  })

  test('starts empty when the setting is off', () => {
    expect(startupWindows([], [['/a']], false, all)).toEqual([[]])
  })

  test('drops folders that are gone, and windows left without any', () => {
    const exists = (folder: string) => folder !== '/gone'
    expect(startupWindows([], [['/a', '/gone'], ['/gone']], true, exists)).toEqual([['/a']])
    expect(startupWindows([], [['/gone']], true, exists)).toEqual([[]])
  })
})

describe('windowsToRemember', () => {
  test('keeps the list when the last window closes', () => {
    expect(windowsToRemember([])).toBeUndefined()
  })

  test('remembers the open windows that have repositories', () => {
    expect(windowsToRemember([['/a', '/b'], []])).toEqual([['/a', '/b']])
  })

  test('remembers nothing when the open window has no repository left', () => {
    expect(windowsToRemember([[]])).toEqual([])
  })
})

test('themeSource takes light or dark and follows the system otherwise', () => {
  expect(themeSource('light')).toBe('light')
  expect(themeSource('dark')).toBe('dark')
  expect(themeSource('system')).toBe('system')
  expect(themeSource(undefined)).toBe('system')
  expect(themeSource('blue')).toBe('system')
})

test('desktopFileName matches the installed entry, also inside a Flatpak', () => {
  expect(desktopFileName({})).toBe('ukemi.desktop')
  expect(desktopFileName({ FLATPAK_ID: 'dev.samuelba.ukemi' })).toBe('dev.samuelba.ukemi.desktop')
})
