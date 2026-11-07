import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

test('arrow keys, j, k, Home and End move the selection, and the change pane follows', async () => {
  const { app, page } = await launch(fixtureRepo())
  try {
    await tabIntoGraph(page)
    const focused = page.locator('.commit:focus')
    // The working copy is open, so its file comes first.
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.file:focus')).toHaveAttribute('aria-label', 'src/cart.js, modified')
    await page.keyboard.press('ArrowDown')
    await expect(focused).toContainText('docs: explain the setup')
    await expect(focused).toHaveAttribute('aria-selected', 'true')
    await expect(focused).toHaveAttribute('tabindex', '0')
    await expect(page.locator('.detail-summary')).toContainText('docs: explain the setup')

    await page.keyboard.press('j')
    await expect(focused).toContainText('feat: add the cart total')
    await page.keyboard.press('k')
    await expect(focused).toContainText('docs: explain the setup')

    await page.keyboard.press('End')
    await expect(focused).toContainText('feat: add the cart total')
    await page.keyboard.press('Home')
    await expect(focused).toHaveClass(/is-wc/)
  } finally {
    await app.close()
  }
})

test('Right enters the files, Enter opens a diff and Left goes back to the change', async () => {
  const { app, page } = await launch(fixtureRepo())
  try {
    await tabIntoGraph(page)
    await page.keyboard.press('End')
    const row = page.locator('.commit:focus')
    await expect(row).toContainText('feat: add the cart total')
    await expect(row).toHaveAttribute('aria-expanded', 'false')

    await page.keyboard.press('ArrowRight')
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(row.locator('.file', { hasText: 'cart.js' })).toBeVisible()
    await page.keyboard.press('ArrowRight')
    const file = page.locator('.file:focus')
    await expect(file).toHaveAttribute('aria-label', 'src/cart.js, added')
    await expect(file).toHaveAttribute('aria-level', '2')

    await page.keyboard.press('Enter')
    await expect(page.locator('.detail-diff')).toBeVisible()

    await file.focus()
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.commit:focus')).toContainText('feat: add the cart total')
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.commit:focus')).toHaveAttribute('aria-expanded', 'false')
  } finally {
    await app.close()
  }
})

test('focus stays on the working copy when a snapshot rewrites it', async () => {
  const repo = fixtureRepo()
  const { app, page } = await launch(repo)
  try {
    await tabIntoGraph(page)
    const before = await page.locator('.commit:focus').getAttribute('data-commit-id')
    writeFileSync(join(repo, 'notes.txt'), 'remember\n')
    await page.evaluate(() =>
      window.ukemiHost?.postMessage({ type: 'desktop.run', command: 'ukemi.refresh' }),
    )
    await expect(page.locator('.commit.is-wc')).not.toHaveAttribute('data-commit-id', before ?? '')
    await expect(page.locator('.commit.is-wc')).toBeFocused()
  } finally {
    await app.close()
  }
})

test('Shift+F10 and the menu key ask for the context menu of the focused row', async () => {
  const { app, page } = await launch(fixtureRepo())
  try {
    await tabIntoGraph(page)
    // Caught before the app's listener, so no native menu opens during the test.
    await page.evaluate(() => {
      const seen: string[] = []
      Object.assign(window, { seenMenus: seen })
      window.addEventListener(
        'contextmenu',
        (event) => {
          event.stopImmediatePropagation()
          event.preventDefault()
          const row = event.target instanceof Element ? event.target.closest('.commit') : null
          seen.push(row?.classList.contains('is-wc') ? 'wc' : 'other')
        },
        true,
      )
    })
    const seen = () => page.evaluate(() => (window as unknown as { seenMenus: string[] }).seenMenus)
    await page.keyboard.press('Shift+F10')
    await expect.poll(seen).toEqual(['wc'])
    await page.keyboard.press('ContextMenu')
    await expect.poll(seen).toEqual(['wc', 'wc'])
  } finally {
    await app.close()
  }
})
