import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const root = resolve(__dirname, '../..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  contributes: {
    commands: Array<{ command: string }>
    menus: Record<string, Array<{ command?: string; alt?: string; submenu?: string }>>
    configuration: { properties: Record<string, unknown> }
  }
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

  test('the webview only sends registered commands', () => {
    const sent = [...webviewSource.matchAll(/'(ukemi\.[\w.]+)'/g)].map((m) => m[1])
    expect(sent.filter((c) => c && !registered.has(c))).toEqual([])
  })

  test('declares every setting the host reads', () => {
    const config = readFileSync(join(root, 'src/vscode/config.ts'), 'utf8')
    const read = [...config.matchAll(/c\.get<[^>]+>\('([\w.]+)'/g)].map((m) => `ukemi.${m[1]}`)
    expect(read.filter((key) => !(key in pkg.contributes.configuration.properties))).toEqual([])
  })
})
