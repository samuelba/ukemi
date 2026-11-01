import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  evaluateWhen,
  inlineActions,
  parseWhen,
  resolveMenu,
  type MenuManifest,
} from '../../shared/menus'

const root = resolve(__dirname, '../..')
const manifest = (
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { contributes: MenuManifest }
).contributes

const commitContext = {
  webviewId: 'ukemi.graph',
  webviewSection: 'ukemi.commit',
  isImmutable: false,
  isWorkingCopy: false,
  isEmpty: false,
}

describe('when clauses', () => {
  test('reads a bare key as its truthiness', () => {
    expect(evaluateWhen('isEmpty', { isEmpty: true })).toBe(true)
    expect(evaluateWhen('isEmpty', {})).toBe(false)
    expect(evaluateWhen('!isEmpty', {})).toBe(true)
  })

  test('compares with == and != against quoted and bare values', () => {
    expect(evaluateWhen("webviewSection == 'ukemi.commit'", commitContext)).toBe(true)
    expect(evaluateWhen('view == ukemi.graph', { view: 'ukemi.graph' })).toBe(true)
    expect(evaluateWhen("webviewSection != 'ukemi.commit'", commitContext)).toBe(false)
    expect(evaluateWhen('isTrunk == true', { isTrunk: true })).toBe(true)
  })

  test('matches a regex with =~', () => {
    expect(evaluateWhen('webviewId =~ /^ukemi\\.graph/', commitContext)).toBe(true)
    expect(evaluateWhen('webviewId =~ /^ukemi\\.graph/', { webviewId: 'ukemi.split' })).toBe(false)
    expect(evaluateWhen('viewItem =~ /^workspace(\\+.*)?$/i', { viewItem: 'WORKSPACE+open' })).toBe(
      true,
    )
  })

  test('applies && before ||, with parentheses and negation', () => {
    expect(evaluateWhen('a || b && c', { a: false, b: true, c: false })).toBe(false)
    expect(evaluateWhen('a || b && c', { a: true, b: false, c: false })).toBe(true)
    expect(evaluateWhen('!(a || b)', { a: false, b: false })).toBe(true)
  })

  test('treats literal false and missing clauses as written', () => {
    expect(evaluateWhen('false', {})).toBe(false)
    expect(evaluateWhen('true', {})).toBe(true)
    expect(evaluateWhen(undefined, {})).toBe(true)
  })

  test('parses every when clause the manifest contributes', () => {
    const clauses = Object.values(manifest.menus).flatMap((items) =>
      items.flatMap((item) => (item.when ? [item.when] : [])),
    )
    expect(clauses.length).toBeGreaterThan(100)
    for (const clause of clauses) {
      expect(() => parseWhen(clause), clause).not.toThrow()
    }
  })
})

describe('resolveMenu', () => {
  const commands = (entries: ReturnType<typeof resolveMenu>): string[] =>
    entries.flatMap((entry) =>
      entry.kind === 'command' ? [entry.command] : entry.kind === 'submenu' ? [entry.label] : ['-'],
    )

  test('builds the commit menu in group order with separators', () => {
    const entries = commands(resolveMenu(manifest, 'webview/context', commitContext))
    expect(entries.slice(0, 2)).toEqual(['ukemi.commit.new', 'ukemi.commit.newBefore'])
    expect(entries).toContain('ukemi.commit.describe')
    expect(entries).toContain('Rebase')
    expect(entries).not.toContain('ukemi.commit.makeEditable')
    expect(entries[0]).not.toBe('-')
    expect(entries.at(-1)).not.toBe('-')
    expect(entries.join(' ')).not.toContain('- -')
  })

  test('shows the immutable variants for an immutable change', () => {
    const entries = commands(
      resolveMenu(manifest, 'webview/context', { ...commitContext, isImmutable: true }),
    )
    expect(entries).toContain('ukemi.commit.makeEditable')
    expect(entries).not.toContain('ukemi.commit.describe')
    expect(entries).not.toContain('Rebase')
  })

  test('nests submenu items under their label', () => {
    const rebase = resolveMenu(manifest, 'webview/context', commitContext).find(
      (entry) => entry.kind === 'submenu' && entry.label === 'Rebase',
    )
    expect(rebase?.kind === 'submenu' && commands(rebase.items)).toContain(
      'ukemi.commit.rebaseTrunk',
    )
  })

  test('uses the command title as the label', () => {
    const [first] = resolveMenu(manifest, 'webview/context', commitContext)
    expect(first?.kind === 'command' && first.title).toBe(
      manifest.commands.find((c) => c.command === 'ukemi.commit.new')?.title,
    )
  })

  test('leaves out commands the host does not offer', () => {
    const entries = commands(
      resolveMenu(manifest, 'webview/context', commitContext, (id) => id !== 'ukemi.commit.new'),
    )
    expect(entries).not.toContain('ukemi.commit.new')
  })

  test('every section the webview marks has at least one menu item', () => {
    const sections = ['ukemi.commit', 'ukemi.bookmark', 'ukemi.request', 'ukemi.file']
    for (const section of sections) {
      const entries = resolveMenu(manifest, 'webview/context', {
        webviewId: 'ukemi.graph',
        webviewSection: section,
      })
      expect(entries.length, section).toBeGreaterThan(0)
    }
  })
})

describe('inlineActions', () => {
  const local = 'bookmark+local+present+unsynced'

  test('lists the hover actions of a tree row in their order, with their icons', () => {
    const actions = inlineActions(manifest, 'view/item/context', {
      view: 'ukemi.bookmarks',
      viewItem: local,
    })
    expect(actions.map((a) => a.command)).toEqual([
      'ukemi.bookmark.newChange',
      'ukemi.bookmark.edit',
      'ukemi.bookmark.rename',
      'ukemi.bookmark.delete',
      'ukemi.bookmark.push',
      'ukemi.bookmark.forget',
    ])
    expect(actions[0]).toMatchObject({ icon: 'git-branch', title: expect.any(String) })
  })

  test('follows the when clauses, like the regex lookaheads of workspaces', () => {
    const actions = (viewItem: string) =>
      inlineActions(manifest, 'view/item/context', { view: 'ukemi.workspaces', viewItem }).map(
        (a) => a.command,
      )
    expect(actions('workspace')).toEqual(['ukemi.workspace.openHere', 'ukemi.workspace.open'])
    expect(actions('workspace+open')).toEqual(['ukemi.workspace.open'])
    expect(actions('workspace+missing')).toEqual([])
  })

  test('keeps inline actions out of the context menu, as VS Code does', () => {
    const items = manifest.menus['view/item/context'] ?? []
    const inlineOnly = items
      .filter((item) => item.group?.startsWith('inline'))
      .map((item) => item.command)
      .filter((command) =>
        items.every((item) => item.command !== command || item.group?.startsWith('inline')),
      )
    expect(inlineOnly.length).toBeGreaterThan(0)
    const menu = resolveMenu(manifest, 'view/item/context', {
      view: 'ukemi.bookmarks',
      viewItem: local,
    })
    const listed = menu.flatMap((entry) => (entry.kind === 'command' ? [entry.command] : []))
    expect(listed.filter((command) => inlineOnly.includes(command))).toEqual([])
  })
})
