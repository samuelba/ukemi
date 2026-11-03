import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, test } from 'vitest'
import type { ZoomStep } from '../../shared/desktopProtocol'
import { appMenuTemplate, type AppMenuActions } from '../../src/desktop/menus'

function actions(overrides: Partial<AppMenuActions> = {}): AppMenuActions {
  const none = () => undefined
  return {
    run: none,
    shell: none,
    openRepository: none,
    recent: { roots: [], home: '/home/me' },
    openRecent: none,
    clearRecent: none,
    zoom: { percent: 100, step: none },
    newWindow: none,
    openSettings: none,
    openLog: none,
    about: none,
    openExternal: none,
    isDevelopment: false,
    ...overrides,
  }
}

function menu(template: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
  return template.find((item) => item.label === label)?.submenu as MenuItemConstructorOptions[]
}

function openRecent(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return menu(menu(template, '&File'), 'Open &Recent')
}

describe('File > Open Recent', () => {
  test('lists the repositories newest first and opens the one clicked', () => {
    const opened: string[] = []
    const recent = { roots: ['/home/me/b', '/srv/a&b'], home: '/home/me' }
    const openRecentRoot = (root: string) => void opened.push(root)
    const items = openRecent(appMenuTemplate(actions({ recent, openRecent: openRecentRoot })))
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
    const items = openRecent(appMenuTemplate(actions()))
    expect(items).toEqual([{ label: 'No Recent Repositories', enabled: false }])
  })
})

function zoomItems(percent: number, steps: ZoomStep[] = []): MenuItemConstructorOptions[] {
  const view = menu(
    appMenuTemplate(actions({ zoom: { percent, step: (s) => steps.push(s) } })),
    '&View',
  )
  return view.filter((item) => typeof item.label === 'string' && /zoom/i.test(item.label))
}

describe('View > Zoom', () => {
  test('shows the keys and steps the zoom when clicked', () => {
    const steps: ZoomStep[] = []
    const items = zoomItems(125, steps)
    expect(items.map((item) => [item.label, item.accelerator])).toEqual([
      ['Zoom In', 'CmdOrCtrl+='],
      ['Zoom Out', 'CmdOrCtrl+-'],
      ['Reset Zoom (125%)', 'CmdOrCtrl+0'],
    ])
    for (const item of items) {
      item.click?.({} as never, undefined, {} as never)
    }
    expect(steps).toEqual(['in', 'out', 'reset'])
  })

  test('has nothing to reset at 100%', () => {
    const reset = zoomItems(100).at(-1)
    expect(reset).toMatchObject({ label: 'Reset Zoom', enabled: false })
  })
})
