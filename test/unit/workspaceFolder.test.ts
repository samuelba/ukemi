import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { holdsRepositoryStore, repositoryStore } from '../../src/repo/workspaceFolder'

describe('repositoryStore', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ukemi-store-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('is .jj/repo in the first workspace', () => {
    const main = join(dir, 'main')
    mkdirSync(join(main, '.jj', 'repo'), { recursive: true })
    expect(repositoryStore(main)).toBe(join(main, '.jj', 'repo'))
    expect(holdsRepositoryStore(main)).toBe(true)
  })

  test('follows the relative pointer of a second workspace', () => {
    mkdirSync(join(dir, 'main', '.jj', 'repo'), { recursive: true })
    const second = join(dir, 'second')
    mkdirSync(join(second, '.jj'), { recursive: true })
    // What jj 0.46 writes.
    writeFileSync(join(second, '.jj', 'repo'), '../../main/.jj/repo')
    expect(repositoryStore(second)).toBe(join(dir, 'main', '.jj', 'repo'))
    expect(holdsRepositoryStore(second)).toBe(false)
  })

  test('follows an absolute pointer', () => {
    const store = join(dir, 'main', '.jj', 'repo')
    const second = join(dir, 'second')
    mkdirSync(join(second, '.jj'), { recursive: true })
    writeFileSync(join(second, '.jj', 'repo'), `${store}\n`)
    expect(repositoryStore(second)).toBe(store)
  })

  test('falls back to .jj/repo outside a workspace', () => {
    expect(repositoryStore(dir)).toBe(join(dir, '.jj', 'repo'))
  })
})
