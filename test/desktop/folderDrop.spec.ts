import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test, type Page } from '@playwright/test'
import { fixtureRepo, launch } from './launch'

// A real drop from the file manager can't be scripted, and a page-made File has no path on disk.
// So the host side gets the message a drop sends, and the overlay gets a page-made drag.

const tab = (page: Page, name: string) =>
  page.locator('.repo-tab', { has: page.locator('.repo-tab-label', { hasText: name }) })

test('opens the repository of a dropped file as the active tab', async () => {
  const first = fixtureRepo()
  const second = fixtureRepo()
  const { app, page } = await launch(first)
  try {
    await page.evaluate(
      (path) => {
        window.ukemiHost?.postMessage({ type: 'desktop.openPaths', paths: [path] })
      },
      join(second, 'src', 'cart.js'),
    )
    await expect(tab(page, basename(second))).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.repo-tab')).toHaveCount(2)
  } finally {
    await app.close()
  }
})

test('says when a drop holds nothing to open', async () => {
  const { app, page } = await launch(fixtureRepo())
  try {
    await page.evaluate(
      (path) => {
        window.ukemiHost?.postMessage({ type: 'desktop.openPaths', paths: [path] })
      },
      join(tmpdir(), 'ukemi-no-such-folder'),
    )
    await expect(page.locator('.toast-warning')).toContainText(
      'Could not open ukemi-no-such-folder',
    )
    await expect(page.locator('.repo-tab')).toHaveCount(1)
  } finally {
    await app.close()
  }
})

test('shows the drop hint only while files from outside are dragged over', async () => {
  const { app, page } = await launch(fixtureRepo())
  const drag = (type: string, withFile: boolean) =>
    page.evaluate(
      ([type, withFile]) => {
        const data = new DataTransfer()
        if (withFile) {
          data.items.add(new File(['x'], 'folder'))
        } else {
          data.setData('application/x-ukemi-repo-tab', 'x')
        }
        window.dispatchEvent(new DragEvent(type as string, { dataTransfer: data }))
      },
      [type, withFile] as const,
    )
  try {
    await drag('dragenter', true)
    await expect(page.locator('.folder-drop')).toBeVisible()
    await drag('dragleave', true)
    await expect(page.locator('.folder-drop')).toHaveCount(0)

    // The app's own drags carry their own types, not files.
    await drag('dragenter', false)
    await expect(page.locator('.folder-drop')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
