import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { RepoModel } from '../../src/repo/repoModel'
import { NULL_LOGGER } from '../../src/util/logger'
import { initRepo, jj, makeRepo, makeTempDir, writeFile, type Fixture } from '../helpers/jjFixture'

let fixture: Fixture
let root: string
let model: RepoModel

beforeEach(() => {
  fixture = makeTempDir()
  root = join(fixture.dir, 'repo')
  initRepo(root)
  model = new RepoModel(makeRepo(root), NULL_LOGGER)
})

afterEach(() => fixture.cleanup())

describe('RepoModel', () => {
  test('builds graph state with layout rows and working copy files', async () => {
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'base')
    jj(root, 'new')
    writeFile(root, 'b.txt', 'b\n')

    await model.refresh()

    const graph = model.graph
    expect(model.error).toBeNull()
    expect(graph?.commits).toHaveLength(2)
    expect(graph?.commits[0]?.isWorkingCopy).toBe(true)
    expect(graph?.commits[0]?.row.outgoing).toEqual([{ toColumn: 0, isElided: false }])
    expect(graph?.workingCopyFiles.map((f) => f.path)).toEqual(['b.txt'])
    expect(graph?.canUndo).toBe(true)
    expect(graph?.hasRemotes).toBe(false)
  })

  test('picks up file changes only after markDirty', async () => {
    await model.refresh()
    writeFile(root, 'late.txt', 'x\n')

    await model.refresh()
    expect(model.graph?.workingCopyFiles).toEqual([])

    model.markDirty()
    await model.refresh()
    expect(model.graph?.workingCopyFiles.map((f) => f.path)).toEqual(['late.txt'])
  })

  test('coalesces concurrent refreshes and notifies listeners', async () => {
    let calls = 0
    model.onDidChange(() => calls++)

    await Promise.all([model.refresh(), model.refresh(), model.refresh()])
    await model.refresh()

    expect(calls).toBeGreaterThanOrEqual(2)
    expect(calls).toBeLessThanOrEqual(3)
  })

  test('waits for a refresh queued during the load', async () => {
    await model.refresh()
    let nested = false
    model.onDidChange(() => {
      if (nested) {
        return
      }
      nested = true
      writeFile(root, 'during.txt', 'z\n')
      model.markDirty()
      void model.refresh()
    })
    writeFile(root, 'before.txt', 'y\n')
    model.markDirty()

    await model.refresh()

    expect(model.graph?.workingCopyFiles.map((file) => file.path).sort()).toEqual([
      'before.txt',
      'during.txt',
    ])
  })

  test('reports errors instead of throwing', async () => {
    fixture.cleanup()

    await model.refresh()

    expect(model.error).not.toBeNull()
  })

  test('refreshes after an external jj command', async () => {
    await model.refresh()
    jj(root, 'describe', '-m', 'external')

    await model.refreshIfOperationChanged()

    expect(model.graph?.commits[0]?.description).toBe('external\n')
  })

  test('marks bookmarks that were never pushed as unsynced', async () => {
    const remote = join(fixture.dir, 'remote.git')
    execFileSync('git', ['init', '--bare', '-q', remote])
    jj(root, 'git', 'remote', 'add', 'origin', remote)
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'pushed')
    jj(root, 'bookmark', 'set', 'pushed', '-r', '@')
    jj(root, 'git', 'push', '--bookmark', 'pushed')
    jj(root, 'new', '-m', 'local only')
    writeFile(root, 'b.txt', 'b\n')
    jj(root, 'bookmark', 'set', 'local-only', '-r', '@')

    await model.refresh()

    const bookmarks = model.graph?.commits.flatMap((c) => c.localBookmarks) ?? []
    expect(bookmarks.find((b) => b.name === 'pushed')?.synced).toBe(true)
    expect(bookmarks.find((b) => b.name === 'local-only')?.synced).toBe(false)
    expect(model.graph?.hasUnpushed).toBe(true)
  })

  test('treats bookmarks as synced when the repository has no remote', async () => {
    jj(root, 'bookmark', 'set', 'solo', '-r', '@')

    await model.refresh()

    expect(model.graph?.commits[0]?.localBookmarks).toEqual([
      { name: 'solo', synced: true, conflict: false },
    ])
    expect(model.graph?.hasUnpushed).toBe(false)
  })

  test('knows when redo is possible', async () => {
    jj(root, 'describe', '-m', 'one')
    await model.refresh()
    expect(model.graph?.canRedo).toBe(false)

    jj(root, 'undo')
    await model.refresh()
    expect(model.graph?.canRedo).toBe(true)

    jj(root, 'redo')
    await model.refresh()
    expect(model.graph?.canRedo).toBe(false)
  })

  test('finds the bookmarks of the current stack', async () => {
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'feature')
    jj(root, 'bookmark', 'set', 'feature', '-r', '@')
    jj(root, 'new')

    await model.refresh()

    expect(model.graph?.currentBookmarks).toEqual(['feature'])
  })

  test('uses the default filter from the options', async () => {
    const stackModel = new RepoModel(makeRepo(root), NULL_LOGGER, { filter: 'stack', depth: '14d' })

    await stackModel.refresh()

    expect(stackModel.graph?.filter).toBe('stack')
    expect(stackModel.graph?.depth).toBe('14d')
  })

  test('shows a short first-parent chain for the working copy filter', async () => {
    writeFile(root, 'base.txt', 'base\n')
    jj(root, 'describe', '-m', 'base')
    jj(root, 'bookmark', 'set', 'main', '-r', '@')
    jj(root, 'new', 'main', '-m', 'side')
    const side = jj(root, 'log', '--no-graph', '-r', '@', '-T', 'commit_id')
    jj(root, 'new', 'main', '-m', 'one')
    for (const name of ['two', 'three', 'four', 'five', 'six', 'seven']) {
      jj(root, 'new', '-m', name)
    }
    jj(root, 'new', '@', side, '-m', 'merge')
    const working = new RepoModel(makeRepo(root), NULL_LOGGER, { filter: 'working' })

    await working.refresh()

    expect(working.graph?.commits.map((c) => c.description.trim())).toEqual([
      'merge',
      'seven',
      'six',
      'five',
      'four',
      'three',
    ])
  })

  test('shows the immutable base under a short working copy chain', async () => {
    writeFile(root, 'older.txt', 'older\n')
    jj(root, 'describe', '-m', 'older')
    jj(root, 'new', '-m', 'base')
    jj(root, 'bookmark', 'set', 'base', '-r', '@')
    jj(root, 'new', '-m', 'work')
    jj(root, 'config', 'set', '--repo', 'revset-aliases."immutable_heads()"', 'base')
    const working = new RepoModel(makeRepo(root), NULL_LOGGER, { filter: 'working' })

    await working.refresh()

    expect(working.graph?.commits.map((c) => c.description.trim())).toEqual(['work', 'base'])
  })

  test('reports working-copy line counts only when enabled', async () => {
    writeFile(root, 'b.txt', 'b\n')
    jj(root, 'describe', '-m', 'base')
    jj(root, 'new')
    writeFile(root, 'b.txt', 'b\nextra\n')
    await model.refresh()
    const id = model.graph?.commits.find((commit) => commit.isWorkingCopy)?.commitId ?? ''
    const before = model.graph?.workingCopyFiles.find((file) => file.path === 'b.txt')

    expect(before?.linesAdded).toBeUndefined()
    expect(before?.linesRemoved).toBeUndefined()

    await model.setShowLineStats(true)

    expect(model.graph?.workingCopyFiles.find((file) => file.path === 'b.txt')).toMatchObject({
      linesAdded: 1,
      linesRemoved: 0,
    })
    expect((await model.filesFor(id)).find((file) => file.path === 'b.txt')).toMatchObject({
      linesAdded: 1,
      linesRemoved: 0,
    })
  })

  test('caches file lists by commit id', async () => {
    writeFile(root, 'a.txt', 'a\n')
    await model.refresh()
    const id = model.graph?.commits[0]?.commitId ?? ''

    const first = await model.filesFor(id)
    const second = await model.filesFor(id)

    expect(second).toBe(first)
  })
})
