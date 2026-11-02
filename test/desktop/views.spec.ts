import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

test('keeps a narrow change pane as wide as its column, whatever the diff holds', async () => {
  const repo = fixtureRepo()
  writeFileSync(join(repo, 'src', 'cart.js'), `let sum = "${'x'.repeat(400)}"\n`)
  const { app, page } = await launch(repo)
  try {
    await page.evaluate(() => localStorage.setItem('ukemi.layout', JSON.stringify({ detail: 360 })))
    await page.reload()
    await page.locator('.commit.is-wc').click({ position: { x: 60, y: 8 } })
    await page.locator('.detail-file-list .file', { hasText: 'cart.js' }).click()
    await expect(page.locator('.detail-diff .diff-row').first()).toBeVisible()
    const pane = await page.locator('.right-pane').boundingBox()
    const detail = await page.locator('.detail').boundingBox()
    expect(detail?.width).toBe(pane?.width)
  } finally {
    await app.close()
  }
})

test('fits the title bar and every pane into a narrow window', async () => {
  const { app, page } = await launch(fixtureRepo())
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(720, 600))
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(720)
    const rightEdge = (selector: string) =>
      page.locator(selector).evaluate((element) => element.getBoundingClientRect().right)
    expect(await rightEdge('.titlebar')).toBeLessThanOrEqual(720)
    expect(await rightEdge('.right-pane')).toBeLessThanOrEqual(720)
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

test('keeps a closed tab of a scanned folder closed after the window closed', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'ukemi-desktop-folder-'))
  for (const name of ['one', 'two']) {
    execFileSync('jj', ['git', 'init', join(folder, name)])
  }
  const first = await launch(folder)
  const tabs = first.page.locator('.repo-tab')
  await expect(tabs).toHaveCount(2)
  await tabs.filter({ hasText: 'two' }).hover()
  await tabs.filter({ hasText: 'two' }).locator('.repo-tab-close').click()
  await expect(tabs).toHaveCount(1)
  const closed = first.app.waitForEvent('close')
  await first.page.close()
  await closed

  const second = await launch([], {}, first.userData)
  try {
    await expect(second.page.locator('.repo-tab')).toHaveCount(1)
    await expect(second.page.locator('.repo-tab')).toHaveAttribute('title', join(folder, 'one'))
  } finally {
    await second.app.close()
  }
})

test('splits the sidebar into bookmarks and workspaces that scroll and resize apart', async () => {
  const repo = fixtureRepo()
  const names = Array.from({ length: 40 }, (_, i) => `feature/a-rather-long-topic-name-${i}`)
  execFileSync('jj', ['bookmark', 'create', ...names, '-r', '@-'], { cwd: repo })
  const { app, page } = await launch(repo)
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 600))
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeLessThan(600)
    const bookmarks = page.locator('.side-section[aria-label="Bookmarks"] .side-section-body')
    const workspaces = page.locator('.side-section[aria-label="Workspaces"]')
    await expect(bookmarks.locator('.side-row').first()).toBeVisible()
    expect(await bookmarks.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
    // A long name must not widen the list past the sidebar, where its scrollbar would hide.
    const sidebar = await page.locator('.sidebar').boundingBox()
    const list = await bookmarks.boundingBox()
    expect(list?.width).toBe(sidebar?.width)
    const header = await workspaces.locator('.side-section-header').boundingBox()
    const viewport = await page.evaluate(() => window.innerHeight)
    expect((header?.y ?? viewport) + (header?.height ?? 0)).toBeLessThanOrEqual(viewport)

    const heightOf = async () => (await workspaces.boundingBox())?.height ?? 0
    const before = await heightOf()
    // The window settles after the resize. A press on the 1px handle must not miss it.
    const handle = page.getByRole('separator', { name: 'Resize bookmarks and workspaces' })
    let settled = -1
    await expect
      .poll(async () => {
        const top = (await handle.boundingBox())?.y ?? 0
        const isSettled = top === settled
        settled = top
        return isSettled
      })
      .toBe(true)
    const splitter = await handle.boundingBox()
    const x = (splitter?.x ?? 0) + (splitter?.width ?? 0) / 2
    const y = (splitter?.y ?? 0) + (splitter?.height ?? 0) / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (const step of [20, 40, 60, 80]) {
      await page.mouse.move(x, y + step)
    }
    await page.mouse.up()
    await expect.poll(heightOf).toBeLessThan(before - 60)
    const after = await heightOf()

    await page.reload()
    await expect(workspaces).toBeVisible()
    await expect.poll(heightOf).toBeCloseTo(after, 0)
  } finally {
    await app.close()
  }
})

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

test('shows the working copy and its bookmark in a status bar at the bottom', async () => {
  const { app, page } = await launch(fixtureRepo())
  try {
    const bar = page.locator('.status-bar')
    const atBottom = async () => {
      const box = await bar.boundingBox()
      const height = await page.evaluate(() => window.innerHeight)
      return Math.round((box?.y ?? 0) + (box?.height ?? 0)) === height
    }
    await expect(bar.locator('.status-change')).toContainText('(no description)')
    // No remote: the nearest bookmark, without tracking.
    await expect(bar.locator('.status-bookmark')).toHaveText('docs-setup')
    await expect(bar.locator('.status-sync')).toBeVisible()
    await expect.poll(atBottom).toBe(true)

    await page.locator('.commit', { hasText: 'feat: add the cart total' }).click()
    await expect(page.locator('.commit.is-wc')).not.toHaveClass(/is-selected/)
    await bar.locator('.status-change').click()
    await expect(page.locator('.commit.is-wc')).toHaveClass(/is-selected/)

    await page.getByTitle('Toggle panel: terminal and log').click()
    await expect(page.locator('.bottom-panel')).toBeVisible()
    await expect.poll(atBottom).toBe(true)
    await page.getByTitle('Toggle panel: terminal and log').click()
    await expect.poll(atBottom).toBe(true)
  } finally {
    await app.close()
  }
})

test('keeps settings for one repository apart from the others', async () => {
  const first = fixtureRepo()
  const second = fixtureRepo()
  const { app, page, userData } = await launch([first, second])
  const stored = () => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
  try {
    const active = page.locator('.repo-tab.is-active')
    const repoId = (await active.getAttribute('data-repo-id')) ?? ''
    const label = await active.locator('.repo-tab-label').innerText()
    // The tab's right-click menu runs this command for the tab's repository.
    expect(JSON.parse((await active.getAttribute('data-vscode-context')) ?? '{}')).toMatchObject({
      webviewSection: 'ukemi.repoTab',
      repoId,
    })
    await page.evaluate(
      (id) =>
        window.ukemiHost?.postMessage({
          type: 'desktop.run',
          command: 'ukemi.openRepositorySettings',
          arg: { repoId: id },
        }),
      repoId,
    )
    const scope = page.getByRole('radio', { name: label })
    await expect(scope).toHaveAttribute('aria-checked', 'true')
    // Only the settings a repository can override.
    await expect(page.locator('#setting-changeIdLength')).toHaveCount(0)
    const tags = page.locator('#setting-showGitTags')
    await expect(tags.locator('.setting-scope')).toHaveText('Same as all repositories')
    await tags.locator('.switch').click()
    await expect.poll(() => stored().repositories?.[repoId]).toEqual({ showGitTags: false })
    expect(stored().showGitTags).toBeUndefined()
    await expect(tags.locator('.setting-scope')).toHaveText('Set for this repository')

    await page.getByRole('radio', { name: 'All repositories' }).click()
    await expect(tags.locator('.setting-overridden')).toContainText(label)
    await expect(tags.locator('.switch input')).toBeChecked()

    await page.getByRole('radio', { name: label }).click()
    await tags.locator('button', { hasText: 'Use the value for all' }).click()
    await expect.poll(() => stored().repositories).toBeUndefined()
  } finally {
    await app.close()
  }
})

test('reopens a repository with the filter it was left at', async () => {
  const repo = fixtureRepo()
  const first = await launch(repo)
  try {
    await first.page.locator('.compact-select').first().selectOption('mine')
    await expect(first.page.locator('.compact-select').first()).toHaveValue('mine')
  } finally {
    await first.app.close()
  }
  const second = await launch(repo, {}, first.userData)
  try {
    await expect(second.page.locator('.compact-select').first()).toHaveValue('mine')
  } finally {
    await second.app.close()
  }
})

test('renames, reorders and pins repository tabs, and keeps them on the next start', async () => {
  const repos = [fixtureRepo(), fixtureRepo(), fixtureRepo()]
  const first = await launch(repos)
  const labels = (page: typeof first.page) => page.locator('.repo-tab-label').allInnerTexts()
  let arranged: string[] = []
  try {
    const { page } = first
    const tabs = page.locator('.repo-tab')
    await expect(tabs).toHaveCount(3)

    await tabs.nth(2).locator('.repo-tab-label').dblclick()
    await page.locator('.repo-tab-input').fill('Mono')
    await page.keyboard.press('Enter')
    await expect(tabs.nth(2).locator('.repo-tab-label')).toHaveText('Mono')

    await tabs.nth(2).dragTo(tabs.nth(0), { targetPosition: { x: 4, y: 10 } })
    await expect(tabs.nth(0).locator('.repo-tab-label')).toHaveText('Mono')

    // The keyboard moves the focused tab, and it keeps the focus for the next press.
    await tabs.nth(0).click()
    await tabs.nth(0).focus()
    await page.keyboard.press('Control+Shift+PageDown')
    await expect(tabs.nth(1).locator('.repo-tab-label')).toHaveText('Mono')
    await page.keyboard.press('Control+Shift+PageDown')
    await expect(tabs.nth(2).locator('.repo-tab-label')).toHaveText('Mono')
    await page.keyboard.press('Control+Shift+PageUp')
    await page.keyboard.press('Control+Shift+PageUp')
    await expect(tabs.nth(0).locator('.repo-tab-label')).toHaveText('Mono')

    // Rename from the menu, then type the folder name: the custom name goes.
    const monoId = (await tabs.nth(0).getAttribute('data-repo-id')) ?? ''
    await page.evaluate(
      (repoId) =>
        window.ukemiHost?.postMessage({
          type: 'desktop.run',
          command: 'ukemi.repoTab.rename',
          arg: { repoId },
        }),
      monoId,
    )
    await expect(page.locator('.repo-tab-input')).toBeFocused()
    await page.locator('.repo-tab-input').fill(monoId.split('/').at(-1) ?? '')
    await page.keyboard.press('Enter')
    await expect(tabs.nth(0).locator('.repo-tab-label')).not.toHaveText('Mono')
    await page.locator('.repo-tab-label').first().dblclick()
    await page.locator('.repo-tab-input').fill('Mono')
    await page.keyboard.press('Enter')
    await expect(tabs.nth(0).locator('.repo-tab-label')).toHaveText('Mono')
    expect(
      JSON.parse(readFileSync(join(first.userData, 'state.json'), 'utf8')).repoTabs.names,
    ).toEqual({ [monoId]: 'Mono' })

    const secondId = (await tabs.nth(1).getAttribute('data-repo-id')) ?? ''
    await page.evaluate(
      (repoId) =>
        window.ukemiHost?.postMessage({
          type: 'desktop.run',
          command: 'ukemi.repoTab.pin',
          arg: { repoId },
        }),
      secondId,
    )
    await expect(tabs.nth(0)).toHaveClass(/is-pinned/)
    await expect(tabs.nth(0).locator('.codicon-pinned')).toBeVisible()
    await tabs.nth(0).click({ button: 'middle' })
    await expect(tabs).toHaveCount(3)
    arranged = await labels(page)
    expect(arranged[1]).toBe('Mono')
  } finally {
    await first.app.close()
  }

  // Started without repositories on the command line, the pinned one still opens.
  const second = await launch([], { 'desktop.restoreRepositories': false }, first.userData)
  try {
    await expect(second.page.locator('.repo-tab')).toHaveCount(1)
    await expect(second.page.locator('.repo-tab')).toHaveClass(/is-pinned/)
    expect(await labels(second.page)).toEqual([arranged[0]])
  } finally {
    await second.app.close()
  }

  const third = await launch(repos, {}, first.userData)
  try {
    await expect.poll(() => labels(third.page)).toEqual(arranged)
  } finally {
    await third.app.close()
  }
})
