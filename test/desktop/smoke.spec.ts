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

test('reloads a crashed window and keeps its running shell', async () => {
  const repo = fixtureRepo()
  const { app, page } = await launch(repo)
  // Playwright gives up on a page whose renderer crashed, so the reloaded page is read from main.
  const pageText = () =>
    app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents
      if (!contents || contents.isCrashed()) {
        return ''
      }
      // A page that is going away never answers, so each read gives up after a second.
      const text = contents.executeJavaScript('document.body.innerText') as Promise<string>
      const later = new Promise<string>((resolve) => setTimeout(() => resolve(''), 1000))
      return Promise.race([text.catch(() => ''), later])
    })
  try {
    await page.locator('.titlebar button[title^="Toggle panel"]').click()
    await page.locator('.bottom-tabs button[title="New terminal"]').click()
    const terminal = page.locator('.terminal-view:not([hidden])')
    await terminal.click()
    await page.keyboard.type('answer=42')
    await page.keyboard.press('Enter')

    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer(),
    )

    await expect.poll(pageText, { timeout: 15_000 }).toContain('docs: explain the setup')
    await expect.poll(pageText).toContain('Ukemi reloaded the window')
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents
      for (const key of 'echo kept=$answer') {
        contents?.sendInputEvent({ type: 'char', keyCode: key })
      }
      contents?.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
      contents?.sendInputEvent({ type: 'char', keyCode: '\r' })
    })
    await expect.poll(pageText).toContain('kept=42')
  } finally {
    await app.close()
  }
})
