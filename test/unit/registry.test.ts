import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Emitter } from '../../src/app/events'
import type { Folder, Host } from '../../src/app/host'
import { RepoRegistry } from '../../src/app/registry'
import type { JjRunner } from '../../src/jj/runner'
import { DEFAULT_EXCLUDES } from '../../src/repo/discovery'
import type { Logger } from '../../src/util/logger'
import { makeTempDir, type Fixture } from '../helpers/jjFixture'

vi.mock('../../src/repo/repoModel', () => ({
  RepoModel: class {
    graph = null
    constructor(readonly repo: { root: string }) {}
    get root() {
      return this.repo.root
    }
    onDidChange = () => () => undefined
    refresh = async () => undefined
    refreshWorkingCopy = async () => undefined
    refreshIfOperationChanged = async () => undefined
    markDirty = () => undefined
  },
}))

let fixture: Fixture

beforeEach(() => {
  fixture = makeTempDir()
})

afterEach(() => {
  vi.useRealTimers()
  fixture.cleanup()
})

function makeRepoDir(path: string, marker: '.jj' | '.git' = '.jj'): string {
  const root = join(fixture.dir, path)
  mkdirSync(join(root, marker), { recursive: true })
  return root
}

function setup(folderPaths: string[]) {
  const folders: Folder[] = folderPaths.map((path) => ({ name: path, path }))
  const folderEmitter = new Emitter<void>()
  const focusEmitter = new Emitter<void>()
  const folderChanges = new Map<string, () => void>()
  const store = new Map<string, unknown>()
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger
  const host = {
    settings: {
      read: () => ({
        repoScanDepth: 4,
        repoScanExclude: DEFAULT_EXCLUDES,
        followActiveEditor: true,
        defaultFilter: 'all',
        historyDepth: 100,
        savedRevsets: [],
        defaultRevset: '',
        snapshotOnRefresh: false,
        showLineStats: false,
      }),
    },
    window: { isFocused: true, onDidFocus: focusEmitter.event },
    folders: {
      folders: () => folders,
      onDidChangeFolders: folderEmitter.event,
      activeFile: () => undefined,
      onDidChangeActiveFile: () => ({ dispose: () => undefined }),
    },
    watchRepo: () => ({ dispose: () => undefined }),
    watchFolder: (folder: string, onChange: () => void) => {
      folderChanges.set(folder, onChange)
      return { dispose: () => folderChanges.delete(folder) }
    },
    store: {
      get: (key: string) => store.get(key),
      update: async (key: string, value: unknown) => void store.set(key, value),
    },
  } as unknown as Host
  const registry = new RepoRegistry({} as JjRunner, logger, host)
  const ids = () => registry.summaries().map((s) => s.id)
  return { registry, ids, folders, folderChanges, focusEmitter, logger }
}

async function flushRescan(trigger: () => void): Promise<void> {
  vi.useFakeTimers()
  trigger()
  await vi.runAllTimersAsync()
  vi.useRealTimers()
}

describe('RepoRegistry.discover', () => {
  test('keeps a repository added by hand outside the open folders', async () => {
    const folder = join(fixture.dir, 'ws')
    const inside = makeRepoDir('ws/a')
    const outside = makeRepoDir('elsewhere')
    const { registry, ids } = setup([folder])
    await registry.discover()

    await registry.addRepo(outside)
    await registry.discover()

    expect(ids().sort()).toEqual([outside, inside].sort())
    expect(registry.activeRepoId).toBe(outside)
  })

  test('drops a kept repository once it is no longer a jj repository', async () => {
    const outside = makeRepoDir('elsewhere')
    const { registry, ids } = setup([])
    await registry.addRepo(outside)

    rmSync(join(outside, '.jj'), { recursive: true })
    await registry.discover()

    expect(ids()).toEqual([])
  })

  test('drops a scanned repository that went away', async () => {
    const folder = join(fixture.dir, 'ws')
    const a = makeRepoDir('ws/a')
    const b = makeRepoDir('ws/b')
    const { registry, ids } = setup([folder])
    await registry.discover()

    rmSync(b, { recursive: true })
    await registry.discover()

    expect(ids()).toEqual([a])
  })

  test('closing a kept repository removes it for good', async () => {
    const outside = makeRepoDir('elsewhere')
    const { registry, ids } = setup([])
    await registry.addRepo(outside)

    await registry.remove(outside)
    await registry.discover()

    expect(ids()).toEqual([])
  })

  test('calls made during a scan share one follow-up scan', async () => {
    const folder = join(fixture.dir, 'ws')
    makeRepoDir('ws/a')
    const { registry } = setup([folder])

    const first = registry.discover()
    const second = registry.discover()
    const third = registry.discover()

    expect(third).toBe(second)
    expect(second).not.toBe(first)
    await Promise.all([first, second, third])
  })

  test('logs a failed scan instead of rejecting', async () => {
    const { registry, logger } = setup([])
    vi.spyOn(registry as unknown as { scan(): Promise<void> }, 'scan').mockRejectedValueOnce(
      new Error('boom'),
    )

    await expect(registry.discover()).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('boom'))
  })
})

describe('RepoRegistry finds new repositories', () => {
  test('rescans when a watched folder reports a change', async () => {
    const folder = join(fixture.dir, 'ws')
    mkdirSync(folder)
    const { registry, ids, folderChanges } = setup([folder])
    await registry.discover()
    expect(ids()).toEqual([])

    const repo = makeRepoDir('ws/new', '.git')
    await flushRescan(() => folderChanges.get(folder)?.())
    await registry.discover()

    expect(registry.summaries()).toEqual([expect.objectContaining({ id: repo, kind: 'git' })])
  })

  test('rescans when the window gets focus', async () => {
    const folder = join(fixture.dir, 'ws')
    mkdirSync(folder)
    const { registry, ids, focusEmitter } = setup([folder])
    await registry.discover()

    const repo = makeRepoDir('ws/deep/down/new')
    await flushRescan(() => focusEmitter.fire())
    await registry.discover()

    expect(ids()).toEqual([repo])
  })

  test('picks up a git repository turning into a jj one', async () => {
    const folder = makeRepoDir('ws', '.git')
    const { registry, folderChanges } = setup([folder])
    await registry.discover()
    expect(registry.summaries()[0]?.kind).toBe('git')
    expect(folderChanges.has(folder)).toBe(true)

    mkdirSync(join(folder, '.jj'))
    await registry.discover()

    expect(registry.summaries()).toEqual([expect.objectContaining({ id: folder, kind: 'jj' })])
    expect(folderChanges.has(folder)).toBe(false)
  })

  test('does not watch a folder that is a jj repository', async () => {
    const folder = makeRepoDir('ws')
    const { registry, folderChanges } = setup([folder])
    await registry.discover()

    expect(folderChanges.size).toBe(0)
  })

  test('stops watching a folder that was closed', async () => {
    const a = join(fixture.dir, 'a')
    mkdirSync(a)
    const { registry, folders, folderChanges } = setup([a])
    await registry.discover()
    expect(folderChanges.has(a)).toBe(true)

    folders.splice(0)
    await registry.discover()

    expect(folderChanges.size).toBe(0)
  })
})
