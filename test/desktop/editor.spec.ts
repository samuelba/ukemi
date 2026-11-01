import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { conflictedChanges, conflictRepo, launch } from './launch'

test('resolves a conflict in a change below the working copy', async () => {
  const repo = conflictRepo()
  const { app, page } = await launch(repo)
  try {
    expect(conflictedChanges(repo)).toEqual(['wc', 'merge'])
    await page.locator('.commit', { hasText: 'merge' }).first().click()
    await page.locator('.detail-tag-conflict', { hasText: 'resolve' }).click()

    await expect(page.locator('.right-pane .pane-tab.is-active')).toContainText('Resolve')
    const editor = page.locator('.editor-tab')
    await expect(editor.locator('.editor-badge')).toContainText('rewrites')
    await expect(editor.locator('.editor-count')).toHaveText(/of 1/)
    await expect(editor.locator('.cm-line.cm-conflict-marker').first()).toBeVisible()

    const headings = editor.locator('.cm-conflict-heading')
    await expect(headings.first()).toHaveText('side 1 · "mine" · shown as changes from "base"')
    await expect(headings.nth(1)).toHaveText('side 2 · "theirs"')
    await editor.locator('.cm-conflict-actions button', { hasText: 'Accept "theirs"' }).click()
    await expect(editor.locator('.cm-conflict-actions')).toHaveCount(0)
    await expect(editor.locator('.editor-dirty')).toBeVisible()
    await editor.locator('.editor-actions .button', { hasText: 'Save' }).click()

    await expect(editor.locator('.editor-banner.is-done')).toBeVisible({ timeout: 15_000 })
    await expect(editor.locator('.editor-file .codicon-check')).toHaveCount(1)
    expect(conflictedChanges(repo)).toEqual([])
  } finally {
    await app.close()
  }
})

test('edits a working-copy file and saves it with Ctrl+S', async () => {
  const repo = conflictRepo()
  const { app, page } = await launch(repo)
  try {
    await page.locator('.commit.is-wc').click({ position: { x: 60, y: 8 } })
    await page.evaluate(() =>
      window.ukemiHost?.postMessage({
        type: 'desktop.run',
        command: 'ukemi.file.edit',
        arg: { path: 'notes.txt' },
      }),
    )

    const editor = page.locator('.editor-tab')
    await expect(editor.locator('.editor-badge')).toHaveText('working copy')
    await editor.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('two\n')
    await expect(editor.locator('.editor-dirty')).toBeVisible()
    await page.keyboard.press('ControlOrMeta+s')

    await expect(editor.locator('.editor-dirty')).toHaveCount(0, { timeout: 15_000 })
    expect(readFileSync(join(repo, 'notes.txt'), 'utf8')).toBe('one\ntwo\n')
  } finally {
    await app.close()
  }
})

test('opens the conflict from the status bar', async () => {
  const { app, page } = await launch(conflictRepo())
  try {
    const conflicts = page.locator('.status-bar .status-conflicts')
    await expect(conflicts).toHaveText('1 conflicted file, 2 conflicted changes')
    await conflicts.click()
    await expect(page.locator('.commit.is-selected')).toContainText('merge')
    await expect(page.locator('.right-pane .pane-tab.is-active')).toContainText('Resolve')
    await expect(page.locator('.editor-tab .cm-conflict-heading').first()).toBeVisible()
  } finally {
    await app.close()
  }
})
