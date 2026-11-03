import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, test } from 'vitest'
import type { ZoomStep } from '../../shared/desktopProtocol'
import { isAccelerator } from '../../shared/accelerators'
import {
  appMenuTemplate,
  SHORTCUT_ACTIONS,
  shortcutKeys,
  type AppMenuActions,
} from '../../src/desktop/menus'

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
    keys: shortcutKeys(undefined),
    openKeyboardShortcuts: none,
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

function fileItem(
  keys: Record<string, string>,
  label: string,
): MenuItemConstructorOptions | undefined {
  const file = menu(appMenuTemplate(actions({ keys: shortcutKeys(keys) })), '&File')
  return file.find((item) => item.label === label)
}

describe('keyboard shortcuts', () => {
  test('gives the menu items their default keys', () => {
    expect(fileItem({}, 'Open Repository…')?.accelerator).toBe('CmdOrCtrl+O')
    expect(fileItem({}, 'Keyboard Shortcuts')?.accelerator).toBeUndefined()
  })

  test('uses the keys from the settings, and removes an empty one', () => {
    const keys = { 'app.openRepository': 'Alt+O', 'app.newWindow': '' }
    expect(fileItem(keys, 'Open Repository…')?.accelerator).toBe('Alt+O')
    expect(fileItem(keys, 'New Window')?.accelerator).toBeUndefined()
  })

  test('keeps the default for keys the menu cannot bind and drops unknown actions', () => {
    const keys = shortcutKeys({
      'app.openRepository': 'Q',
      'app.unknown': 'Ctrl+Q',
      'ukemi.fetch': 7,
    })
    expect(keys['app.openRepository']).toBe('CmdOrCtrl+O')
    expect(keys['ukemi.fetch']).toBe('CmdOrCtrl+Shift+F')
    expect('app.unknown' in keys).toBe(false)
  })

  test('every action has a menu item, and every default is a valid shortcut', () => {
    const template = appMenuTemplate(actions())
    const labels = new Set(
      template.flatMap((top) =>
        ((top.submenu as MenuItemConstructorOptions[] | undefined) ?? []).map((item) => item.label),
      ),
    )
    for (const action of SHORTCUT_ACTIONS) {
      expect(labels).toContain(action.title)
      expect(action.key === '' || isAccelerator(action.key)).toBe(true)
    }
  })
})
