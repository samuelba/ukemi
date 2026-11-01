import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { fixtureRepo, launch } from './launch'

test('opens repositories as tabs of one window', async () => {
  const first = fixtureRepo()
  const second = fixtureRepo()
  const { app, page } = await launch([first, second])
  try {
    const tabs = page.locator('.repo-tab')
    await expect(tabs).toHaveCount(2)
    expect(app.windows()).toHaveLength(1)
    const inactive = page.locator('.repo-tab:not(.is-active)')
    const name = await inactive.locator('.repo-tab-label').innerText()
    await inactive.click()
    await expect(page.locator('.repo-tab.is-active .repo-tab-label')).toHaveText(name)
    await page.locator('.repo-tab.is-active .repo-tab-close').click()
    await expect(tabs).toHaveCount(1)
  } finally {
    await app.close()
  }
})

test('opens Split and Clean up as tabs beside the change', async () => {
  const { app, page } = await launch(fixtureRepo())
  try {
    await page.locator('.commit', { hasText: 'feat: add the cart total' }).click()
    await page.evaluate(() =>
      window.ukemiHost?.postMessage({ type: 'desktop.run', command: 'ukemi.commit.split' }),
    )
    await expect(page.locator('.right-pane .pane-tab.is-active')).toContainText('Split')
    await expect(page.locator('.split')).toBeVisible()
    expect(app.windows()).toHaveLength(1)
    await page.locator('.split button', { hasText: 'Cancel' }).click()
    await expect(page.locator('.right-pane .pane-tab', { hasText: 'Split' })).toHaveCount(0)
    await expect(page.locator('.right-pane .pane-tab.is-active')).toContainText('Change')

    await page.evaluate(() =>
      window.ukemiHost?.postMessage({ type: 'desktop.run', command: 'ukemi.cleanup' }),
    )
    await expect(page.locator('.right-pane .pane-tab.is-active')).toContainText('Clean up')
    await expect(page.locator('.cleanup')).toBeVisible()
    await page.locator('.right-pane .pane-tab.is-active .repo-tab-close').click()
    await expect(page.locator('.right-pane .pane-tab', { hasText: 'Clean up' })).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('shows the files as a tree, the evolution, and a diff that grows and closes', async () => {
  const { app, page } = await launch(fixtureRepo(), { changedFilesView: 'tree' })
  try {
    await page.locator('.commit.is-wc').click({ position: { x: 60, y: 8 } })
    const files = page.locator('.detail-file-list')
    await expect(files.locator('.dir', { hasText: 'src' }).or(files.getByText('src'))).toBeVisible()
    await expect(page.locator('.evolution-row').first()).toBeVisible()

    await files.locator('.file', { hasText: 'cart.js' }).click()
    await expect(page.locator('.detail-diff')).toBeVisible()
    await page.locator('.detail-diff-bar button[title="Maximize"]').click()
    await expect(page.locator('.detail-summary')).toHaveCount(0)
    await page.locator('.detail-diff-bar button[title="Restore"]').click()
    await expect(page.locator('.detail-summary')).toBeVisible()
    await page.locator('.detail-diff-bar button[title^="Close"]').click()
    await expect(page.locator('.detail-diff')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('edits settings in a form and keeps them in settings.json', async () => {
  const { app, page, userData } = await launch(fixtureRepo())
  try {
    await page.evaluate(() =>
      window.ukemiHost?.postMessage({ type: 'desktop.run', command: 'ukemi.openSettings' }),
    )
    await expect(page.locator('.right-pane .pane-tab.is-active')).toContainText('Settings')
    const setting = page.locator('#setting-showGitTags')
    await setting.locator('.switch').click()
    await expect
      .poll(() => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).showGitTags)
      .toBe(false)
    await expect(setting).toHaveClass(/is-modified/)
    await setting.locator('button', { hasText: 'Reset' }).click()
    await expect(setting).not.toHaveClass(/is-modified/)
  } finally {
    await app.close()
  }
})

test('runs a shell in the bottom panel, in the repository, next to the log', async () => {
  const repo = fixtureRepo()
  const { app, page } = await launch(repo)
  try {
    await page.locator('.titlebar button[title^="Toggle panel"]').click()
    await page.locator('.bottom-tabs button[title="New terminal"]').click()
    const terminal = page.locator('.terminal-view:not([hidden])')
    await expect(terminal.locator('.xterm')).toBeVisible()
    await terminal.click()
    await page.keyboard.type('echo answer=$((6*7)); pwd')
    await page.keyboard.press('Enter')
    await expect(terminal.locator('.xterm-rows')).toContainText('answer=42')
    await expect(terminal.locator('.xterm-rows')).toContainText(repo)

    await page.locator('.bottom-tab', { hasText: 'Log' }).click()
    await expect(page.locator('.log-line', { hasText: 'jj log' }).first()).toBeVisible()
    await page
      .locator('.bottom-tab', { hasText: 'ukemi-desktop-repo' })
      .locator('.repo-tab-close')
      .click()
    await expect(page.locator('.terminal-view')).toHaveCount(0)
    await page.locator('.bottom-tabs button[title="Hide the panel"]').click()
    await expect(page.locator('.bottom-panel')).toBeHidden()
  } finally {
    await app.close()
  }
})

for (const restore of [true, false]) {
  test(`${restore ? 'reopens' : 'does not reopen'} the repositories after the window closed`, async () => {
    const repo = fixtureRepo()
    const first = await launch(repo, { 'desktop.restoreRepositories': restore })
    const closed = first.app.waitForEvent('close')
    await first.page.close()
    await closed

    const second = await launch([], { 'desktop.restoreRepositories': restore }, first.userData)
    try {
      if (restore) {
        await expect(second.page.locator('.repo-tab')).toHaveCount(1)
        await expect(second.page.locator('.repo-tab').first()).toHaveAttribute('title', repo)
      } else {
        await expect(second.page.locator('.empty')).toBeVisible()
        await expect(second.page.locator('.repo-tab')).toHaveCount(0)
      }
    } finally {
      await second.app.close()
    }
  })
}

test('starts with the working copy selected, and keeps it selected after edits', async () => {
  const repo = fixtureRepo()
  const { app, page } = await launch(repo)
  try {
    const workingCopy = page.locator('.commit.is-wc')
    await expect(workingCopy).toHaveClass(/is-selected/)
    await expect(page.locator('.detail-tag-here')).toBeVisible()
    writeFileSync(join(repo, 'src', 'cart.js'), 'let sum = 1\nexport { sum }\n')
    await page.locator('.titlebar').click()
    await page.evaluate(() =>
      window.ukemiHost?.postMessage({ type: 'desktop.run', command: 'ukemi.refresh' }),
    )
    await expect(workingCopy).toHaveClass(/is-selected/)
  } finally {
    await app.close()
  }
})

test('shows line stats as soon as they are switched on', async () => {
  const { app, page } = await launch(fixtureRepo())
  try {
    await expect(page.locator('.commit.is-wc .line-stats')).toHaveCount(0)
    await page.evaluate(() =>
      window.ukemiHost?.postMessage({
        type: 'desktop.setSetting',
        key: 'showLineStats',
        value: true,
      }),
    )
    await expect(page.locator('.commit.is-wc .line-stats').first()).toBeVisible()
  } finally {
    await app.close()
  }
})

test('switches between light and dark from the settings', async () => {
  const { app, page } = await launch(fixtureRepo(), { 'desktop.theme': 'dark' })
  const isDark = () =>
    page.evaluate(() => document.documentElement.classList.contains('vscode-dark'))
  try {
    await expect.poll(isDark).toBe(true)
    await page.evaluate(() =>
      window.ukemiHost?.postMessage({
        type: 'desktop.setSetting',
        key: 'desktop.theme',
        value: 'light',
      }),
    )
    await expect.poll(isDark).toBe(false)
  } finally {
    await app.close()
  }
})

test('uses the font settings in diffs and terminals, live', async () => {
  const { app, page } = await launch(fixtureRepo(), {
    'desktop.editor.fontFamily': "'DejaVu Sans Mono', monospace",
    'desktop.editor.fontSize': 15,
  })
  const editorFont = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-font-family'),
    )
  try {
    await expect.poll(editorFont).toContain('DejaVu Sans Mono')
    await page.locator('.titlebar button[title^="Toggle panel"]').click()
    await page.locator('.bottom-tabs button[title="New terminal"]').click()
    const rows = page.locator('.terminal-view:not([hidden]) .xterm-rows')
    await expect(rows).toHaveCSS('font-family', /DejaVu Sans Mono/)

    await page.evaluate(() =>
      window.ukemiHost?.postMessage({
        type: 'desktop.setSetting',
        key: 'desktop.terminal.fontFamily',
        value: 'Liberation Mono',
      }),
    )
    await expect(rows).toHaveCSS('font-family', /Liberation Mono/)
    await expect.poll(editorFont).toContain('DejaVu Sans Mono')
  } finally {
    await app.close()
  }
})

test('shows Help > About with the version, jj and the license', async () => {
  const { app, page } = await launch(fixtureRepo())
  try {
    await app.evaluate(({ Menu }) => {
      const help = Menu.getApplicationMenu()?.items.find((item) => item.role === 'help')
      help?.submenu?.items.find((item) => item.label === 'About Ukemi')?.click()
    })
    const about = page.locator('.about')
    await expect(about).toBeVisible()
    const version = (
      JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
        version: string
      }
    ).version
    await expect(about.locator('.about-version')).toHaveText(version)
    await expect(about.locator('.about-fact', { hasText: 'jj' })).toContainText(/\d+\.\d+\.\d+/)
    await expect(about).toContainText('MIT License')
    await page.keyboard.press('Escape')
    await expect(about).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('shows the hover buttons of the extension on bookmark rows, and runs them', async () => {
  const titles = new Map(
    (
      JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
        contributes: { commands: Array<{ command: string; title: string }> }
      }
    ).contributes.commands.map((c) => [c.command, c.title]),
  )
  const { app, page } = await launch(fixtureRepo())
  try {
    const row = page.locator('.side-row', { hasText: 'docs-setup' })
    await row.hover()
    const button = (command: string) =>
      row.locator(`.row-actions button[title="${titles.get(command)}"]`)
    await expect(button('ukemi.bookmark.newChange')).toBeVisible()
    await expect(button('ukemi.bookmark.delete')).toBeVisible()
    await button('ukemi.bookmark.rename').click()
    await expect(page.locator('.prompt .prompt-input')).toHaveValue('docs-setup')
    await page.keyboard.press('Escape')
  } finally {
    await app.close()
  }
})
