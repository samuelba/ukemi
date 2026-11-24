import { expect, test, type Locator, type Page } from '@playwright/test'
import { fixtureRepo, launch } from './launch'

// What an input method sends while it composes: Enter picks a candidate, Escape drops it.
async function composeKeys(input: Locator) {
  for (const key of ['Enter', 'Escape']) {
    await input.dispatchEvent('keydown', { key, isComposing: true, bubbles: true })
  }
}

async function openFromPalette(page: Page, text: string, option: RegExp) {
  await page.keyboard.press('F1')
  await page.locator('.palette .prompt-input').fill(text)
  await expect(page.getByRole('option', { name: option, selected: true })).toBeVisible()
}

test('keys that compose text leave the palette and the prompts open', async () => {
  const { app, page } = await launch(fixtureRepo())
  try {
    await openFromPalette(page, 'new change from bookmark', /^New change from bookmark/i)
    await composeKeys(page.locator('.palette .prompt-input'))
    await expect(page.locator('.palette')).toBeVisible()

    await page.keyboard.press('Enter')
    const pick = page.locator('.prompt[role="dialog"]:not(.palette)')
    await expect(pick).toBeVisible()
    await composeKeys(pick.locator('.prompt-input'))
    await expect(pick).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(pick).toHaveCount(0)

    await page.evaluate(() => {
      window.ukemiHost?.postMessage({
        type: 'desktop.run',
        command: 'ukemi.bookmark.rename',
        arg: { kind: 'bookmark', repoId: '', name: 'docs-setup', remote: null, commitId: null },
      })
    })
    const input = page.locator('.prompt .prompt-input')
    await expect(input).toHaveValue('docs-setup')
    await composeKeys(input)
    await expect(input).toBeVisible()
    await expect(page.locator('.side-row', { hasText: 'docs-setup' })).toBeVisible()
  } finally {
    await app.close()
  }
})

test('keys that compose text keep the Describe dialog and its message', async () => {
  const { app, page } = await launch(fixtureRepo())
  try {
    await page.locator('.commit.is-wc').click({ position: { x: 60, y: 8 } })
    await page.evaluate(() =>
      window.ukemiHost?.postMessage({ type: 'desktop.run', command: 'ukemi.commit.describe' }),
    )
    const dialog = page.getByRole('dialog', { name: /^Describe/ })
    const textarea = dialog.locator('textarea')
    await textarea.fill('feat: 日本語')
    await textarea.dispatchEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      isComposing: true,
      bubbles: true,
    })
    await composeKeys(textarea)

    await expect(textarea).toHaveValue('feat: 日本語')
  } finally {
    await app.close()
  }
})

test('keys that compose text keep the bookmark filter', async () => {
  const { app, page } = await launch(fixtureRepo())
  try {
    const filter = page.getByPlaceholder('Filter bookmarks')
    await filter.fill('docs')
    await composeKeys(filter)
    await expect(filter).toHaveValue('docs')
  } finally {
    await app.close()
  }
})
