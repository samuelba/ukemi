import { expect, test, type Page } from '@playwright/test'
import { fixtureRepo, launch } from './launch'

// Presses Tab until a row of the graph tree has focus, as a keyboard user gets there.
async function tabIntoGraph(page: Page) {
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    const role = await page.evaluate(() => document.activeElement?.getAttribute('role'))
    if (role === 'treeitem') {
      return
    }
  }
  throw new Error('Tab never reached the graph')
}

test('the graph is a tree whose tab stop is the working copy', async () => {
  const { app, page } = await launch(fixtureRepo())
  try {
    const tree = page.getByRole('tree', { name: 'Changes' })
    await expect(tree).toBeVisible()
    await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1)

    await tabIntoGraph(page)
    const focused = page.locator('.commit:focus')
    await expect(focused).toHaveClass(/is-wc/)
    await expect(focused).toHaveAttribute('aria-selected', 'true')
    await expect(focused).toHaveAttribute('aria-level', '1')
    await expect(focused.locator('.sr-only')).toContainText('working copy')
    // The files inside the expanded row are not part of its name.
    await expect(focused).toHaveAccessibleName(/working copy/)
    await expect(focused).not.toHaveAccessibleName(/cart\.js/)
  } finally {
    await app.close()
  }
})
