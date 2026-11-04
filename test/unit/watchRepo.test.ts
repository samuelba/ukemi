import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { IgnoreRules, isInternal, type ReadText } from '../../src/desktop/adapters/ignoreRules'
import { FolderTreeWatcher } from '../../src/desktop/adapters/treeWatcher'
import { changeFilter } from '../../src/desktop/adapters/watchRepo'
import type { Logger } from '../../src/util/logger'

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger

function rulesFrom(files: Record<string, string>): IgnoreRules {
  const read: ReadText = (path) => Promise.resolve(files[path] ?? null)
  return new IgnoreRules('/repo', read)
}

describe('isInternal', () => {
  test.each(['.jj', '.git', '.jj/working_copy/checkout', '.git/index', 'vendor/lib/.git/HEAD'])(
    'skips jj and git bookkeeping in %s',
    (name) => {
      expect(isInternal(name)).toBe(true)
    },
  )

  test.each([
    '.gitignore',
    '.gitattributes',
    '.github/workflows/ci.yml',
    '.jjconfig.toml',
    'src/a.ts',
  ])('reports a change to %s', (name) => {
    expect(isInternal(name)).toBe(false)
  })
})

describe('IgnoreRules', () => {
  test('ignores folders listed in the root .gitignore and everything below them', async () => {
    const rules = rulesFrom({ '/repo/.gitignore': 'node_modules/\ntarget\n*.log\n' })

    expect(await rules.isIgnored('node_modules', true)).toBe(true)
    expect(await rules.isIgnored('node_modules/react/index.js', false)).toBe(true)
    expect(await rules.isIgnored('crates/a/target', true)).toBe(true)
    expect(await rules.isIgnored('build.log', false)).toBe(true)
    expect(await rules.isIgnored('src/index.ts', false)).toBe(false)
    expect(await rules.isIgnored('.gitignore', false)).toBe(false)
  })

  test('a folder-only pattern does not match a file of that name', async () => {
    const rules = rulesFrom({ '/repo/.gitignore': 'out/\n' })

    expect(await rules.isIgnored('out', true)).toBe(true)
    expect(await rules.isIgnored('out', false)).toBe(false)
  })

  test('a nested .gitignore applies below its folder and can re-include a file', async () => {
    const rules = rulesFrom({
      '/repo/.gitignore': '*.gen.ts\n',
      '/repo/web/.gitignore': 'dist/\n!keep.gen.ts\n',
    })

    expect(await rules.isIgnored('web/dist', true)).toBe(true)
    expect(await rules.isIgnored('dist', true)).toBe(false)
    expect(await rules.isIgnored('web/a.gen.ts', false)).toBe(true)
    expect(await rules.isIgnored('web/keep.gen.ts', false)).toBe(false)
  })

  test('reads info/exclude from the git repo behind the jj store', async () => {
    const rules = rulesFrom({
      '/repo/.jj/repo/store/git_target': '../../../.git\n',
      '/repo/.git/info/exclude': 'scratch/\n',
    })

    expect(await rules.isIgnored('scratch/notes.md', false)).toBe(true)
  })

  test('picks up a changed .gitignore after invalidate', async () => {
    const files: Record<string, string> = { '/repo/.gitignore': '' }
    const rules = new IgnoreRules('/repo', (path) => Promise.resolve(files[path] ?? null))
    expect(await rules.isIgnored('dist', true)).toBe(false)

    files['/repo/.gitignore'] = 'dist/\n'
    expect(await rules.isIgnored('dist', true)).toBe(false)
    rules.invalidate('')
    expect(await rules.isIgnored('dist', true)).toBe(true)
  })
})

describe('changeFilter', () => {
  test('reports changes jj would snapshot and drops ignored and internal ones', async () => {
    const onChange = vi.fn()
    const listener = changeFilter(rulesFrom({ '/repo/.gitignore': 'target/\n' }), onChange, logger)

    listener(join('target', 'debug', 'app'))
    listener(join('.jj', 'working_copy', 'checkout'))
    await new Promise((done) => setTimeout(done, 20))
    expect(onChange).not.toHaveBeenCalled()

    listener(join('src', 'main.rs'))
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
  })
})

describe('FolderTreeWatcher', () => {
  let root: string
  let watcher: FolderTreeWatcher | null

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ukemi-watch-'))
    watcher = null
  })

  afterEach(() => {
    watcher?.dispose()
    rmSync(root, { recursive: true, force: true })
  })

  async function start(onChange = vi.fn(), maxFolders?: number): Promise<FolderTreeWatcher> {
    watcher = new FolderTreeWatcher({
      root,
      rules: new IgnoreRules(root),
      onChange,
      logger,
      maxFolders,
    })
    await watcher.start()
    return watcher
  }

  test('watches each tracked folder once and skips ignored and internal ones', async () => {
    writeFileSync(join(root, '.gitignore'), 'node_modules/\ntarget\n')
    for (const folder of [
      'src/a',
      'node_modules/react/lib',
      'target/debug',
      '.jj/repo',
      '.git/objects',
    ]) {
      mkdirSync(join(root, folder), { recursive: true })
    }

    const tree = await start()

    expect([...tree.watchedFolders].sort()).toEqual(['', 'src', 'src/a'])
  })

  test('reports file changes in tracked folders but not in ignored files', async () => {
    writeFileSync(join(root, '.gitignore'), '*.log\n')
    mkdirSync(join(root, 'src'))
    const onChange = vi.fn()
    await start(onChange)

    writeFileSync(join(root, 'src', 'debug.log'), 'x')
    await new Promise((done) => setTimeout(done, 150))
    expect(onChange).not.toHaveBeenCalled()

    writeFileSync(join(root, 'src', 'a.ts'), 'x')
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
  })

  test('starts watching a folder created later, including what it already holds', async () => {
    const onChange = vi.fn()
    const tree = await start(onChange)

    mkdirSync(join(root, 'pkg', 'src'), { recursive: true })

    await vi.waitFor(() => expect(tree.watchedFolders).toContain('pkg/src'))
    onChange.mockClear()
    writeFileSync(join(root, 'pkg', 'src', 'b.ts'), 'x')
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
  })

  test('stops watching a removed folder', async () => {
    mkdirSync(join(root, 'old', 'inner'), { recursive: true })
    const tree = await start()

    rmSync(join(root, 'old'), { recursive: true })

    await vi.waitFor(() => expect(tree.watchedFolders).toEqual(['']))
  })

  test('re-reads the rules when a .gitignore changes', async () => {
    mkdirSync(join(root, 'dist'))
    const tree = await start()
    expect(tree.watchedFolders).toContain('dist')

    writeFileSync(join(root, '.gitignore'), 'dist/\n')

    await vi.waitFor(() => expect(tree.watchedFolders).not.toContain('dist'))
  })

  test('stops adding folders at the limit and says so', async () => {
    for (const folder of ['a', 'b', 'c']) {
      mkdirSync(join(root, folder))
    }
    vi.mocked(logger.warn).mockClear()

    const tree = await start(vi.fn(), 2)

    expect(tree.watchedFolders).toHaveLength(2)
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })
})
