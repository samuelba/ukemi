import { describe, expect, test } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { appMenuTemplate, type AppMenuActions } from '../../src/desktop/menus'
import {
  forget,
  MAX_RECENT,
  readRecent,
  recentLabel,
  remember,
} from '../../src/desktop/recentRepos'

describe('readRecent', () => {
  test('keeps the stored paths in order', () => {
    expect(readRecent(['/a', '/b'])).toEqual(['/a', '/b'])
  })

  test('drops what is not a path, duplicates and the overflow', () => {
    expect(readRecent(['/a', 3, '', '/a', null, '/b'])).toEqual(['/a', '/b'])
    expect(readRecent({ '/a': true })).toEqual([])
    const many = Array.from({ length: MAX_RECENT + 5 }, (_, i) => `/r${i}`)
    expect(readRecent(many)).toHaveLength(MAX_RECENT)
  })
})

describe('remember', () => {
  test('puts the repository first and moves it there when listed', () => {
    expect(remember(['/a', '/b'], '/c')).toEqual(['/c', '/a', '/b'])
    expect(remember(['/a', '/b', '/c'], '/b')).toEqual(['/b', '/a', '/c'])
  })

  test('lets the oldest fall off', () => {
    const full = Array.from({ length: MAX_RECENT }, (_, i) => `/r${i}`)
    const next = remember(full, '/new')
    expect(next).toHaveLength(MAX_RECENT)
    expect(next[0]).toBe('/new')
    expect(next).not.toContain(`/r${MAX_RECENT - 1}`)
  })

  test('forget removes one repository', () => {
    expect(forget(['/a', '/b'], '/a')).toEqual(['/b'])
  })
})

describe('recentLabel', () => {
  test('shortens the home folder to ~', () => {
    expect(recentLabel('/home/me/src/repo', '/home/me')).toBe('~/src/repo')
  })

  test('keeps other paths, and the home folder itself, as they are', () => {
    expect(recentLabel('/srv/repo', '/home/me')).toBe('/srv/repo')
    expect(recentLabel('/home/meet/repo', '/home/me')).toBe('/home/meet/repo')
    expect(recentLabel('/home/me', '/home/me')).toBe('/home/me')
  })
})

function actions(roots: string[], opened: string[] = []): AppMenuActions {
  const none = () => undefined
  return {
    run: none,
    shell: none,
    openRepository: none,
    recent: { roots, home: '/home/me' },
    openRecent: (root) => opened.push(root),
    clearRecent: none,
    newWindow: none,
    openSettings: none,
    openLog: none,
    about: none,
    openExternal: none,
    isDevelopment: false,
  }
}

function openRecent(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const file = template.find((menu) => menu.label === '&File')
  const items = file?.submenu as MenuItemConstructorOptions[]
  return items.find((item) => item.label === 'Open &Recent')
    ?.submenu as MenuItemConstructorOptions[]
}

describe('File > Open Recent', () => {
  test('lists the repositories newest first and opens the one clicked', () => {
    const opened: string[] = []
    const items = openRecent(appMenuTemplate(actions(['/home/me/b', '/srv/a&b'], opened)))
    expect(items.map((item) => item.label ?? item.type)).toEqual([
      '~/b',
      '/srv/a&&b',
      'separator',
      'Clear Recently Opened',
    ])
    items[1]?.click?.({} as never, undefined, {} as never)
    expect(opened).toEqual(['/srv/a&b'])
  })

  test('says so when nothing was opened yet', () => {
    const items = openRecent(appMenuTemplate(actions([])))
    expect(items).toEqual([{ label: 'No Recent Repositories', enabled: false }])
  })
})
