import { expect, test } from '@playwright/test'
import { fixtureRepo, launch, logOf } from './launch'

test('shows the graph, the details and the diff of a change', async () => {
  const repo = fixtureRepo()
  const { app, page } = await launch(repo)
  try {
    await expect(page.locator('.commit', { hasText: 'docs: explain the setup' })).toBeVisible()
    await expect(page.locator('.side-row', { hasText: 'docs-setup' })).toBeVisible()

    await page.locator('.commit', { hasText: 'feat: add the cart total' }).click()
    await expect(page.locator('.detail-subject')).toHaveText('feat: add the cart total')
    await page.locator('.detail-file-list .file', { hasText: 'cart.js' }).click()
    await expect(page.locator('.diff-added').first()).toContainText('let total = 0')
  } finally {
    await app.close()
  }
})

test('shows the working copy edits with word marks', async () => {
  const repo = fixtureRepo()
  const { app, page } = await launch(repo)
  try {
    // The row's first line selects it. Its file list below opens a file.
    await page.locator('.commit.is-wc').click({ position: { x: 60, y: 8 } })
    await page.locator('.detail-file-list .file', { hasText: 'cart.js' }).click()
    await expect(page.locator('.diff-removed mark').first()).toHaveText('total')
    await expect(page.locator('.diff-added mark').first()).toHaveText('sum')
  } finally {
    await app.close()
  }
})

test('runs a command from the palette and undoes it with the keyboard', async () => {
  const repo = fixtureRepo()
  const { app, page } = await launch(repo)
  const changes = () => logOf(repo).split('\n').filter(Boolean).length
  try {
    const before = changes()
    await page.keyboard.press('F1')
    await page.locator('.palette .prompt-input').fill('new change from trunk')
    await page.keyboard.press('Enter')
    await expect.poll(changes).toBe(before + 1)
    await page.locator('.graph-pane').click({ position: { x: 300, y: 400 } })
    await page.keyboard.press('Control+z')
    await expect.poll(changes).toBe(before)
  } finally {
    await app.close()
  }
})

test('prompts in the window and applies the answer', async () => {
  const repo = fixtureRepo()
  const { app, page } = await launch(repo)
  try {
    await page.keyboard.press('F1')
    await page.locator('.palette .prompt-input').fill('rename')
    await expect(page.locator('.palette .pick-item')).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page
      .locator('.side-row', { hasText: 'docs-setup' })
      .locator('.row-actions button[title="More actions"]')
      .click()
    // The row menu is native. Run its rename command through the same path as a menu click.
    await page.evaluate(() => {
      window.ukemiHost?.postMessage({
        type: 'desktop.run',
        command: 'ukemi.bookmark.rename',
        arg: { kind: 'bookmark', repoId: '', name: 'docs-setup', remote: null, commitId: null },
      })
    })
    const input = page.locator('.prompt .prompt-input')
    await expect(input).toHaveValue('docs-setup')
    await input.fill('bad name')
    await page.keyboard.press('Enter')
    await expect(page.locator('.prompt-problem')).toBeVisible()
    await input.fill('docs-guide')
    await page.keyboard.press('Enter')
    await expect(page.locator('.side-row', { hasText: 'docs-guide' })).toBeVisible()
  } finally {
    await app.close()
  }
})
