import { expect, test } from '@playwright/test'
import { launch, longRepo } from './launch'

const HISTORY = 700
// The graph's first page (GRAPH_PAGE_SIZE).
const PAGE = 500

test('loads more of a long history when the graph scrolls to its end', async () => {
  const { app, page } = await launch(longRepo(HISTORY), { historyDepth: 'all' })
  try {
    const rows = page.locator('.commit')
    const more = page.locator('.load-more')
    await expect(rows).toHaveCount(PAGE)
    await expect(more).toContainText(`newest ${PAGE} changes`)

    await more.scrollIntoViewIfNeeded()

    // All of main, `side` and the working copy.
    await expect(rows).toHaveCount(HISTORY + 2)
    await expect(more).toHaveCount(0)
  } finally {
    await app.close()
  }
})
