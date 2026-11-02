import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { fixtureRepo, launch, logOf } from './launch'

// A stand-in for Claude Code on PATH that answers every prompt with the same description.
function fakeClaude(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ukemi-fake-claude-'))
  const path = join(dir, 'claude')
  writeFileSync(
    path,
    '#!/bin/sh\n[ "$1" = "--version" ] && { echo "1.0.0 (fake)"; exit 0; }\ncat > /dev/null\necho "refactor: rename the cart total to sum"\n',
  )
  chmodSync(path, 0o755)
  return dir
}

test('suggests a description with a detected tool, and undoes it', async () => {
  const savedPath = process.env.PATH
  process.env.PATH = `${fakeClaude()}${delimiter}${savedPath ?? ''}`
  const repo = fixtureRepo()
  const { app, page } = await launch(repo, { 'describeSuggest.tools': ['claude'] })
  try {
    await page.locator('.commit.is-wc').click({ position: { x: 60, y: 8 } })
    await page.evaluate(() =>
      window.ukemiHost?.postMessage({ type: 'desktop.run', command: 'ukemi.commit.describe' }),
    )
    const dialog = page.getByRole('dialog')
    const textarea = dialog.locator('textarea')
    await textarea.fill('wip')

    await dialog.getByRole('button', { name: 'Claude' }).click()
    await expect(textarea).toHaveValue('refactor: rename the cart total to sum')
    await dialog.getByRole('button', { name: 'Undo' }).click()
    await expect(textarea).toHaveValue('wip')

    await dialog.getByRole('button', { name: 'Claude' }).click()
    await expect(textarea).toHaveValue('refactor: rename the cart total to sum')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => logOf(repo)).toContain('refactor: rename the cart total to sum')
  } finally {
    process.env.PATH = savedPath
    await app.close()
  }
})
