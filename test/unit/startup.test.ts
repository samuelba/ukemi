import { describe, expect, test } from 'vitest'
import {
  desktopFileName,
  foldersAfterClosing,
  startupWindows,
  themeSource,
  windowShowing,
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

describe('startupWindows with pinned repositories', () => {
  test('always opens pinned repositories in the first window', () => {
    expect(startupWindows([], [['/a'], ['/c']], true, all, ['/p'])).toEqual([['/a', '/p'], ['/c']])
    expect(startupWindows([], [['/a']], false, all, ['/p'])).toEqual([['/p']])
    expect(startupWindows(['/x'], [], true, all, ['/p'])).toEqual([['/x', '/p']])
  })

  test('skips pinned repositories that are open or gone', () => {
    const exists = (folder: string) => folder !== '/gone'
    expect(
      startupWindows([], [['/a'], ['/p']], true, exists, ['/p', '/gone', '/a/nested']),
    ).toEqual([['/a'], ['/p']])
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

describe('foldersAfterClosing', () => {
  test('drops the folder that is the closed repository', () => {
    expect(foldersAfterClosing(['/a', '/b'], ['/a', '/b'], '/a')).toEqual(['/b'])
  })

  test('turns a scanned folder into the repositories it still shows, in its place', () => {
    const roots = ['/x', '/work/one', '/work/two', '/work/deep/three']
    expect(foldersAfterClosing(['/x', '/work'], roots, '/work/two')).toEqual([
      '/x',
      '/work/one',
      '/work/deep/three',
    ])
  })

  test('drops a folder that lies inside the closed repository', () => {
    expect(foldersAfterClosing(['/repo/src', '/b'], ['/repo', '/b'], '/repo')).toEqual(['/b'])
  })

  test('keeps a repository once when a scanned folder also lists it', () => {
    const roots = ['/work/one', '/work/two']
    expect(foldersAfterClosing(['/work/one', '/work'], roots, '/work/two')).toEqual(['/work/one'])
  })

  test('does not take a sibling with a longer name for a folder inside', () => {
    expect(foldersAfterClosing(['/repo-b'], ['/repo', '/repo-b'], '/repo')).toEqual(['/repo-b'])
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

describe('windowShowing', () => {
  const windows = [
    { folders: ['/a'], repos: ['/a'] },
    { folders: ['/work'], repos: ['/work/x', '/work/y'] },
  ]

  test('finds the window that opened the folder', () => {
    expect(windowShowing('/a', windows)).toBe(0)
    expect(windowShowing('/a/', windows)).toBe(0)
  })

  test('finds a repository found inside an opened folder', () => {
    expect(windowShowing('/work/y', windows)).toBe(1)
  })

  test('is -1 for a repository no window shows', () => {
    expect(windowShowing('/b', windows)).toBe(-1)
    expect(windowShowing('/work/z', windows)).toBe(-1)
  })
})
