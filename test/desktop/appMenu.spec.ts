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
