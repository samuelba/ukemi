import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { fixtureRepo, launch } from './launch'

// The labels of a submenu of the app menu, like ['&File', 'Open &Recent'].
function labels(app: ElectronApplication, path: string[]): Promise<string[]> {
  return app.evaluate(({ Menu }, path) => {
    let items = Menu.getApplicationMenu()?.items ?? []
    for (const label of path) {
      items = items.find((item) => item.label === label)?.submenu?.items ?? []
    }
    return items.map((item) => item.label)
  }, path)
}

function click(app: ElectronApplication, path: string[], label: string): Promise<void> {
  return app.evaluate(
    ({ Menu }, { path, label }) => {
      let items = Menu.getApplicationMenu()?.items ?? []
      for (const name of path) {
        items = items.find((item) => item.label === name)?.submenu?.items ?? []
      }
      const item = items.find((candidate) => candidate.label.startsWith(label))
      if (!item) {
        throw new Error(`no menu item ${label}`)
      }
      item.click()
    },
    { path, label },
  )
}

function zoomFactor(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor(),
  )
}

test('lists the opened repository under File > Open Recent', async () => {
  const repo = fixtureRepo()
  const { app } = await launch(repo)
  try {
    await expect.poll(() => labels(app, ['&File', 'Open &Recent'])).toContain(repo)
  } finally {
    await app.close()
  }
})

test('zooms from the View menu, keeps the zoom and resets it from the status bar', async () => {
  const repo = fixtureRepo()
  const first = await launch(repo)
  try {
    await click(first.app, ['&View'], 'Zoom In')
    await expect(first.page.locator('.status-zoom')).toContainText('110%')
    await expect.poll(() => zoomFactor(first.app)).toBeCloseTo(1.1)
    expect(await labels(first.app, ['&View'])).toContain('Reset Zoom (110%)')
  } finally {
    await first.app.close()
  }

  const second = await launch(repo, {}, first.userData)
  try {
    await expect(second.page.locator('.status-zoom')).toContainText('110%')
    await expect.poll(() => zoomFactor(second.app)).toBeCloseTo(1.1)
    await second.page.locator('.status-zoom button', { hasText: '110%' }).click()
    await expect(second.page.locator('.status-zoom')).toHaveCount(0)
    await expect.poll(() => zoomFactor(second.app)).toBeCloseTo(1)
  } finally {
    await second.app.close()
  }
})

function accelerator(app: ElectronApplication, path: string[], label: string): Promise<string> {
  return app.evaluate(
    ({ Menu }, { path, label }) => {
      let items = Menu.getApplicationMenu()?.items ?? []
      for (const name of path) {
        items = items.find((item) => item.label === name)?.submenu?.items ?? []
      }
      return String(items.find((item) => item.label === label)?.accelerator ?? '')
    },
    { path, label },
  )
}

test('records a new shortcut for a menu command and warns about a clash', async () => {
  const repo = fixtureRepo()
  const { app, page, userData } = await launch(repo)
  const stored = () =>
    (JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as Record<string, unknown>)[
      'desktop.keybindings'
    ]
  try {
    await click(app, ['&File'], 'Keyboard Shortcuts')
    const fetch = page.locator('.shortcut', { hasText: 'Fetch' }).first()
    await expect(fetch.locator('.shortcut-key')).toHaveText('Ctrl+Shift+F')

    await fetch.locator('.shortcut-key').click()
    await expect(fetch.locator('.shortcut-key')).toHaveText('Press keys…')
    await page.keyboard.press('Alt+Shift+K')
    await expect(fetch.locator('.shortcut-key')).toHaveText('Alt+Shift+K')
    await expect.poll(stored).toEqual({ 'ukemi.fetch': 'Alt+Shift+K' })
    await expect.poll(() => accelerator(app, ['&Repository'], 'Fetch')).toBe('Alt+Shift+K')

    // Ctrl+B toggles the sidebar, so recording it must not run the command.
    await fetch.locator('.shortcut-key').click()
    await page.keyboard.press('Control+b')
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(fetch.locator('.shortcut-clash')).toHaveText('Also Toggle Sidebar')

    await fetch.hover()
    await fetch.getByRole('button', { name: 'Reset the shortcut of Fetch' }).click()
    await expect(fetch.locator('.shortcut-key')).toHaveText('Ctrl+Shift+F')
    await expect.poll(stored).toBeUndefined()
  } finally {
    await app.close()
  }
})
