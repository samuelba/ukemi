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

  test('caches file lists by commit id', async () => {
    writeFile(root, 'a.txt', 'a\n')
    await model.refresh()
    const id = model.graph?.commits[0]?.commitId ?? ''

    const first = await model.filesFor(id)
    const second = await model.filesFor(id)

    expect(second).toBe(first)
  })
})
