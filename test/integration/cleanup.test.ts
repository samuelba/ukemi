import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { applyCleanup, loadCleanup } from '../../src/repo/loadCleanup'
import { JJ_BINARY, initRepo, jj, makeRepo, makeTempDir, type Fixture } from '../helpers/jjFixture'
import type { JjRepo } from '../../src/jj/repo'

let fixture: Fixture
let root: string
let repo: JjRepo

beforeEach(() => {
  fixture = makeTempDir()
  root = join(fixture.dir, 'repo')
  initRepo(root)
  repo = makeRepo(root)
})

afterEach(() => fixture.cleanup())

function divergeSameChange(): void {
  jj(root, 'new', '-m', 'shared')
  const op = jj(root, 'op', 'log', '--no-graph', '-n', '1', '-T', 'id.short(16)').trim()
  jj(root, 'describe', '-m', 'side A')
  const result = spawnSync(
    JJ_BINARY,
    ['--color=never', '--at-op', op, 'describe', '-m', 'side B', '--no-integrate-operation'],
    { cwd: root, encoding: 'utf8' },
  )
  const newOp = `${result.stdout}\n${result.stderr}`.match(/requested: ([0-9a-f]+)/)?.[1]
  if (!newOp) {
    throw new Error(`divergent describe failed: ${result.stderr}`)
  }
  jj(root, 'op', 'integrate', newOp)
}

describe('cleanup', () => {
  test('offers a bookmark on trunk and forgets it', async () => {
    jj(root, 'bookmark', 'create', 'wip', '-r', '@')
    jj(root, 'bookmark', 'create', 'landed', '-r', 'trunk()')

    const snapshot = await loadCleanup(repo, [])
    const landed = snapshot.bookmarks.find((bookmark) => bookmark.name === 'landed')

    expect(snapshot.bookmarks.map((bookmark) => bookmark.name)).toEqual(['landed'])
    expect(landed?.checked).toBe(true)
    await applyCleanup(repo, snapshot, {
      bookmarks: ['landed'],
      workspaces: [],
      divergent: [],
    })

    const after = await repo.bookmarkList()
    expect(after.some((bookmark) => bookmark.name === 'landed' && bookmark.remote === null)).toBe(
      false,
    )
  })

  test('groups two describes of the same change as one divergence', async () => {
    divergeSameChange()

    const snapshot = await loadCleanup(repo, [])
    const group = snapshot.divergent[0]
    const kept = group?.revisions.find((revision) => !revision.checked)

    expect(snapshot.divergent).toHaveLength(1)
    expect(group?.revisions).toHaveLength(2)
    expect(kept?.isWorkingCopy).toBe(true)
    expect(kept?.description).toBe('side A')
    if (!group) {
      throw new Error('expected a divergent group')
    }

    await applyCleanup(repo, snapshot, {
      bookmarks: [],
      workspaces: [],
      divergent: group.revisions
        .filter((revision) => revision.checked)
        .map((revision) => revision.commitId),
    })
    expect(await loadCleanup(repo, [])).toMatchObject({ divergent: [] })
  })
})
