import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launch } from './launch'

const JJ_ENV = { JJ_USER: 'Ukemi Test', JJ_EMAIL: 'test@example.com', JJ_CONFIG: '/dev/null' }

function jj(cwd: string, ...args: string[]): string {
  return execFileSync('jj', ['--color=never', ...args], {
    cwd,
    env: { ...process.env, ...JJ_ENV },
    encoding: 'utf8',
  })
}

// A stack s1-s2-s3-s4 with an empty working copy on top.
function stackRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'ukemi-desktop-stack-'))
  jj(repo, 'git', 'init')
  for (const name of ['s1', 's2', 's3', 's4']) {
    jj(repo, 'describe', '-m', name)
    writeFileSync(join(repo, `${name}.txt`), `${name}\n`)
    jj(repo, 'new')
  }
  return repo
}

function stackOrder(repo: string): string[] {
  return jj(
    repo,
    'log',
    '-r',
    '::@- ~ root()',
    '--no-graph',
    '-T',
    'description.first_line() ++ "\\n"',
  )
    .split('\n')
    .filter(Boolean)
}

const row = (page: Page, summary: string) =>
  page.locator('.commit', {
    has: page.locator('.summary', { hasText: new RegExp(`^${summary}$`) }),
  })

// The stack as the graph shows it, top to bottom.
const shownOrder = (page: Page) =>
  page
    .locator('.commit .summary')
    .allTextContents()
    .then((texts) => texts.map((t) => t.trim()).filter((t) => /^s\d$/.test(t)))

// Waits until both jj and the graph show `order`, so the next drag hits the redrawn rows.
async function expectOrder(page: Page, repo: string, order: string[]) {
  await expect.poll(() => stackOrder(repo)).toEqual(order)
  await expect.poll(() => shownOrder(page)).toEqual(order)
}

// Drops `source` on the top edge of `target`, which is the gap between it and the row above.
async function dropAbove(page: Page, source: string, target: string) {
  await row(page, source).dragTo(row(page, target), { targetPosition: { x: 60, y: 1 } })
}

test('reorders a stack by dropping changes between changes, again and again', async () => {
  const repo = stackRepo()
  const { app, page } = await launch(repo)
  try {
    await expect(row(page, 's4')).toBeVisible()

    await dropAbove(page, 's2', 's3')
    await expectOrder(page, repo, ['s4', 's2', 's3', 's1'])

    await dropAbove(page, 's4', 's1')
    await expectOrder(page, repo, ['s2', 's3', 's4', 's1'])

    await dropAbove(page, 's1', 's3')
    await expectOrder(page, repo, ['s2', 's1', 's3', 's4'])
  } finally {
    await app.close()
  }
})

test('reorders after describing a change with the keyboard', async () => {
  const repo = stackRepo()
  const { app, page } = await launch(repo)
  try {
    await expect(row(page, 's4')).toBeVisible()
    const top = page.locator('.commit.is-wc')
    await top.hover()
    await top.locator('button[title="Describe"]').click()
    await page.locator('.dialog textarea').fill('s5')
    await page.locator('.dialog textarea').press('Control+Shift+Enter')
    await expect(row(page, 's5')).toBeVisible()
    await expectOrder(page, repo, ['s5', 's4', 's3', 's2', 's1'])
    // Ctrl released just before a press still duplicates (see dragModifiers), so let it pass.
    await page.waitForTimeout(500)

    await dropAbove(page, 's5', 's2')
    await expectOrder(page, repo, ['s4', 's3', 's5', 's2', 's1'])
  } finally {
    await app.close()
  }
})
