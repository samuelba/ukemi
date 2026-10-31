import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const root = resolve(__dirname, '../..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  contributes: {
    commands: Array<{ command: string }>
    menus: Record<
      string,
      Array<{ command?: string; alt?: string; submenu?: string; when?: string }>
    >
    configuration: { properties: Record<string, { scope?: string }> }
  }
  capabilities?: { untrustedWorkspaces?: { supported?: unknown } }
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? sources(path) : /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

const hostSource = sources(join(root, 'src'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n')
const webviewSource = sources(join(root, 'webview/src'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n')
const registered = new Set([...hostSource.matchAll(/'(ukemi\.[\w.]+)':\s/g)].map((m) => m[1] ?? ''))
const declared = new Set(pkg.contributes.commands.map((c) => c.command))

describe('package.json manifest', () => {
  test('declares every registered command', () => {
    expect([...registered].filter((c) => !declared.has(c))).toEqual([])
  })

  test('registers every declared command', () => {
    expect([...declared].filter((c) => !registered.has(c))).toEqual([])
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

  test('declares limited support for untrusted workspaces', () => {
    expect(pkg.capabilities?.untrustedWorkspaces?.supported).toBe('limited')
  })

  test('declares every setting the host reads', () => {
    const config = readFileSync(join(root, 'src/vscode/config.ts'), 'utf8')
    const read = [...config.matchAll(/c\.get<[^>]+>\('([\w.]+)'/g)].map((m) => `ukemi.${m[1]}`)
    expect(read.filter((key) => !(key in pkg.contributes.configuration.properties))).toEqual([])
  })
})
