import { expect, test, type Page } from '@playwright/test'
import { fixtureRepo, launch } from './launch'

async function openDescribe(page: Page) {
  await page.locator('.commit.is-wc').click({ position: { x: 60, y: 8 } })
  await page.evaluate(() =>
    window.ukemiHost?.postMessage({ type: 'desktop.run', command: 'ukemi.commit.describe' }),
  )
  const dialog = page.getByRole('dialog', { name: /^Describe/ })
  await expect(dialog).toBeVisible()
  return dialog
}

// A point on the backdrop, left of the centred dialog.
async function backdropPoint(page: Page) {
  const box = await page.locator('.dialog').boundingBox()
  if (!box) {
    throw new Error('the dialog has no box')
  }
  return { x: box.x / 2, y: box.y + box.height / 2 }
}

test('a text selection that ends on the backdrop keeps the Describe dialog', async () => {
  const { app, page } = await launch(fixtureRepo())
  try {
    const dialog = await openDescribe(page)
    const textarea = dialog.locator('textarea')
    await textarea.fill('feat: a message worth keeping')

    const start = await textarea.boundingBox()
    if (!start) {
      throw new Error('the textarea has no box')
    }
    const end = await backdropPoint(page)
    await page.mouse.move(start.x + start.width - 10, start.y + 10)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 5 })
    await page.mouse.up()

    await expect(dialog).toBeVisible()
    await expect(textarea).toHaveValue('feat: a message worth keeping')
  } finally {
    await app.close()
  }
})

test('a press on the backdrop closes Describe only while nothing was typed', async () => {
  const { app, page } = await launch(fixtureRepo())
  try {
    const dialog = await openDescribe(page)
    const textarea = dialog.locator('textarea')
    const initial = await textarea.inputValue()
    await textarea.fill(`${initial}typed`)

    const point = await backdropPoint(page)
    await page.mouse.click(point.x, point.y)
    await expect(dialog).toBeVisible()
    await expect(textarea).toHaveValue(`${initial}typed`)

    await textarea.fill(initial)
    await page.mouse.click(point.x, point.y)
    await expect(dialog).toHaveCount(0)
  } finally {
    await app.close()
  }
})
