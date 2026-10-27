import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { CleanupSelection } from '../../shared/cleanup'
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

function selection(overrides: Partial<CleanupSelection> = {}): CleanupSelection {
  return {
    bookmarks: [],
    deletedBookmarks: [],
    deleteRemote: [],
    workspaces: [],
    divergent: [],
    ...overrides,
  }
}

function initBare(dir: string): void {
  const result = spawnSync('git', ['init', '--bare', dir], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr)
  }
}

describe('cleanup', () => {
  test('offers a bookmark on trunk and forgets it', async () => {
    jj(root, 'bookmark', 'create', 'wip', '-r', '@')
    jj(root, 'bookmark', 'create', 'landed', '-r', 'trunk()')

    const snapshot = await loadCleanup(repo, [])
    const landed = snapshot.bookmarks.find((bookmark) => bookmark.name === 'landed')

    expect(snapshot.bookmarks.map((bookmark) => bookmark.name)).toEqual(['landed'])
    expect(landed?.checked).toBe(true)
    await applyCleanup(repo, snapshot, selection({ bookmarks: ['landed'] }))

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

    await applyCleanup(
      repo,
      snapshot,
      selection({
        divergent: group.revisions
          .filter((revision) => revision.checked)
          .map((revision) => revision.commitId),
      }),
    )
    expect(await loadCleanup(repo, [])).toMatchObject({ divergent: [] })
  })

  test('lists a commit with no description and skips the working copy', async () => {
    jj(root, 'new')
    jj(root, 'new', '-m', 'later')
    const [parent] = await repo.log('@-', 1)
    const [workingCopy] = await repo.log('@', 1)
    if (!parent || !workingCopy) {
      throw new Error('expected a parent and a working copy')
    }

    const snapshot = await loadCleanup(repo, [])
    const ids = snapshot.undescribed.map((commit) => commit.commitId)

    expect(ids).toContain(parent.commitId)
    expect(ids).not.toContain(workingCopy.commitId)
    expect(ids.some((id) => /^0+$/.test(id))).toBe(false)
    expect(snapshot.undescribedTruncated).toBe(false)
    expect(
      snapshot.undescribed.find((commit) => commit.commitId === parent.commitId),
    ).toMatchObject({ isEmpty: true })
  })

  test('forgets a deleted local bookmark and leaves the remote', async () => {
    const bare = join(fixture.dir, 'origin.git')
    initBare(bare)
    jj(root, 'describe', '-m', 'topic work')
    jj(root, 'bookmark', 'create', 'topic', '-r', '@')
    jj(root, 'git', 'remote', 'add', 'origin', bare)
    jj(root, 'git', 'push', '--bookmark', 'topic')
    jj(root, 'bookmark', 'delete', 'topic')

    const snapshot = await loadCleanup(repo, [])
    expect(snapshot.deletedBookmarks).toEqual([
      expect.objectContaining({
        name: 'topic',
        remotes: ['origin'],
        checked: true,
        canDeleteRemote: true,
      }),
    ])

    await applyCleanup(repo, snapshot, selection({ deletedBookmarks: ['topic'] }))

    const after = await repo.bookmarkList()
    expect(after.some((bookmark) => bookmark.name === 'topic' && bookmark.remote === null)).toBe(
      false,
    )
    expect(
      after.some(
        (bookmark) => bookmark.name === 'topic' && bookmark.remote === 'origin' && bookmark.present,
      ),
    ).toBe(true)
  })
})
