import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { servedFile } from '../../src/desktop/servedFile'

const dist = mkdtempSync(join(tmpdir(), 'ukemi-dist-'))
for (const file of [
  'extension.js',
  'extension.js.map',
  'askpass.js',
  'desktop/desktop.html',
  'desktop/desktop.js',
  'desktop/desktop.js.map',
  'desktop/main.js',
  'desktop/preload.js',
  'desktop/seti-5TSONOM2.woff',
  'webview/graph.js',
  'webview/graph.css',
  'webview/codicon-FSJRJUGQ.ttf',
]) {
  mkdirSync(join(dist, file, '..'), { recursive: true })
  writeFileSync(join(dist, file), '')
}
afterAll(() => rmSync(dist, { recursive: true, force: true }))

const serve = (path: string, isDevelopment = false) =>
  servedFile(dist, new URL(`ukemi://app${path}`), isDevelopment)

describe('servedFile', () => {
  test.each([
    '/desktop/desktop.html',
    '/desktop/desktop.js',
    '/desktop/seti-5TSONOM2.woff',
    '/webview/graph.js',
    '/webview/graph.css',
    '/webview/codicon-FSJRJUGQ.ttf',
  ])('serves the page file %s', (path) => {
    expect(serve(path)).toBe(join(dist, path))
  })

  test.each([
    '/extension.js',
    '/extension.js.map',
    '/askpass.js',
    '/desktop/main.js',
    '/desktop/preload.js',
    '/desktop/missing.js',
    '/desktop',
    '/desktop/../extension.js',
    '/desktop/%2e%2e/extension.js',
    '/%2e%2e/package.json',
  ])('refuses %s', (path) => {
    expect(serve(path)).toBeNull()
  })

  test('serves source maps only in development', () => {
    expect(serve('/desktop/desktop.js.map')).toBeNull()
    expect(serve('/desktop/desktop.js.map', true)).toBe(join(dist, 'desktop/desktop.js.map'))
  })
})
