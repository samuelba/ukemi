import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { evaluateWhen } from '../../shared/menus'
import { REPOSITORY_KEYS } from '../../shared/settingsScope'
import { manifest as desktopManifest } from '../../src/desktop/menus'

const root = resolve(__dirname, '../..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  contributes: {
    commands: Array<{ command: string; title: string }>
    menus: Record<
      string,
      Array<{ command?: string; alt?: string; submenu?: string; when?: string }>
    >
    configuration: { properties: Record<string, { scope?: string }> }
  }
  capabilities?: {
    untrustedWorkspaces?: { supported?: unknown; restrictedConfigurations?: string[] }
  }
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? sources(path) : /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

const read = (files: string[]) => files.map((file) => readFileSync(file, 'utf8')).join('\n')
const registeredIn = (source: string) =>
  new Set([...source.matchAll(/'(ukemi\.[\w.]+)':\s/g)].map((m) => m[1] ?? ''))

const hostFiles = sources(join(root, 'src'))
const desktopDir = join(root, 'src', 'desktop')
const hostSource = read(hostFiles)
const webviewSource = read(sources(join(root, 'webview/src')))
const registered = registeredIn(hostSource)
// What the VS Code extension registers: everything outside the standalone app.
const extensionRegistered = registeredIn(read(hostFiles.filter((f) => !f.startsWith(desktopDir))))
const title = (command?: string) =>
  pkg.contributes.commands.find((c) => c.command === command)?.title
const declared = new Set(pkg.contributes.commands.map((c) => c.command))
// package.json plus the commands only the standalone app has.
const desktopDeclared = new Set(desktopManifest.commands.map((c) => c.command))

describe('package.json manifest', () => {
  test('declares every registered command', () => {
    expect([...registered].filter((c) => !desktopDeclared.has(c))).toEqual([])
  })

  test('the extension registers every command package.json declares', () => {
    expect([...declared].filter((c) => !extensionRegistered.has(c))).toEqual([])
  })

  test('menus only reference declared commands', () => {
    const used = Object.values(pkg.contributes.menus).flatMap((items) =>
      items.flatMap((item) =>
        [item.command, item.alt].filter((command): command is string => command !== undefined),
      ),
    )
    expect(used.filter((command) => !declared.has(command))).toEqual([])
  })

  test('menu when clauses use only operators VS Code parses', () => {
    const invalid = Object.values(pkg.contributes.menus)
      .flatMap((items) => items.map((item) => item.when ?? ''))
      .filter((when) => when.includes('!~'))
    expect(invalid).toEqual([])
  })

  test('workspace item menus skip open, missing and default workspaces as declared', () => {
    const items = pkg.contributes.menus['view/item/context'] ?? []
    const pattern = (command: string) => {
      const when = items.find((item) => item.command === command)?.when ?? ''
      const source = /viewItem =~ \/(.+)\/$/.exec(when)?.[1] ?? '$^'
      return new RegExp(source)
    }
    const context = (...flags: string[]) => ['workspace', ...flags].join('+')

    expect(pattern('ukemi.workspace.openHere').test(context())).toBe(true)
    expect(pattern('ukemi.workspace.openHere').test(context('open'))).toBe(false)
    expect(pattern('ukemi.workspace.openHere').test(context('missing'))).toBe(false)
    expect(pattern('ukemi.workspace.open').test(context('open'))).toBe(true)
    expect(pattern('ukemi.workspace.open').test(context('missing'))).toBe(false)
    expect(pattern('ukemi.workspace.delete').test(context('current'))).toBe(true)
    expect(pattern('ukemi.workspace.delete').test(context('default'))).toBe(false)
    expect(pattern('ukemi.workspace.open').test('version:openable:comparable')).toBe(false)
  })

  test('the webview only sends registered commands', () => {
    const sent = [...webviewSource.matchAll(/command(?:\(|:\s*)'(ukemi\.[\w.]+)'/g)].map(
      (m) => m[1],
    )
    expect(sent.filter((c) => c && !registered.has(c))).toEqual([])
  })

  test('host and OAuth application settings cannot come from a workspace', () => {
    const keys = ['ukemi.github.hosts', 'ukemi.gitlab.hosts', 'ukemi.gitlab.oauthApplications']
    expect(keys.map((key) => pkg.contributes.configuration.properties[key]?.scope)).toEqual([
      'machine',
      'machine',
      'machine',
    ])
  })

  test('marks exactly the repository settings as resource scoped', () => {
    const scoped = Object.entries(pkg.contributes.configuration.properties)
      .filter(([, schema]) => schema.scope === 'resource')
      .map(([key]) => key.replace(/^ukemi\./, ''))
    expect(scoped.sort()).toEqual([...REPOSITORY_KEYS].sort())
  })

  test('declares limited support for untrusted workspaces', () => {
    expect(pkg.capabilities?.untrustedWorkspaces?.supported).toBe('limited')
  })

  test('ignores workspace values of the settings a hostile repository could abuse', () => {
    const restricted = pkg.capabilities?.untrustedWorkspaces?.restrictedConfigurations ?? []
    expect(restricted).toEqual(
      expect.arrayContaining(['ukemi.autoFetch.enabled', 'ukemi.describeSuggest.instructions']),
    )
    const properties = pkg.contributes.configuration.properties
    expect(restricted.filter((key) => properties[key]?.scope !== 'resource')).toEqual([])
  })

  test('declares every setting the host reads', () => {
    const config = readFileSync(join(root, 'src/app/settings.ts'), 'utf8')
    const read = [...config.matchAll(/c\.get<[^>]+>\('([\w.]+)'/g)].map((m) => `ukemi.${m[1]}`)
    expect(read.filter((key) => !(key in pkg.contributes.configuration.properties))).toEqual([])
  })
  // VS Code ignores `toggled` on contributed menus and commands, so the state shows by swapping
  // commands with `when` clauses instead.
  test('uses no toggled key, which VS Code ignores', () => {
    expect(JSON.stringify(pkg.contributes)).not.toContain('"toggled"')
  })

  test('the view mode menu shows a checked item for exactly the current mode', () => {
    const items = pkg.contributes.menus['ukemi.viewMode'] ?? []
    const shown = (mode: string) =>
      items
        .filter((item) => evaluateWhen(item.when, { 'config.ukemi.changedFilesView': mode }))
        .map((item) => title(item.command))
    expect(shown('list')).toEqual(['✓ View as List', 'View as Tree'])
    expect(shown('tree')).toEqual(['View as List', '✓ View as Tree'])
  })

  test('the evolution view shows either Follow or Pin', () => {
    const items = pkg.contributes.menus['view/title'] ?? []
    const shown = (following: boolean) =>
      items
        .filter((item) => item.command?.startsWith('ukemi.evolution.'))
        .filter((item) =>
          evaluateWhen(item.when, {
            view: 'ukemi.evolution',
            'ukemi.evolution.following': following,
          }),
        )
        .map((item) => item.command)
    expect(shown(true)).toEqual(['ukemi.evolution.pin'])
    expect(shown(false)).toEqual(['ukemi.evolution.follow'])
  })
})
