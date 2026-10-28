import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { CleanupSelection } from '../../shared/cleanup'
import { applyCleanup, loadCleanup } from '../../src/repo/loadCleanup'
import {
  JJ_BINARY,
  initRepo,
  jj,
  makeRepo,
  makeTempDir,
  writeFile,
  type Fixture,
} from '../helpers/jjFixture'
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
    abandonBookmarkCommits: [],
    deletedBookmarks: [],
    deleteRemote: [],
    workspaces: [],
    deleteWorkspaceFiles: [],
    divergent: [],
    undescribed: [],
    ...overrides,
  }
}

function gitRefs(dir: string): string[] {
  const result = spawnSync('git', ['show-ref'], { cwd: dir, encoding: 'utf8' })
  return result.stdout
    .split('\n')
    .map((line) => line.trim().split(' ').at(1) ?? '')
    .filter((ref) => ref.length > 0)
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

  test('forgets a slashed local bookmark and leaves the remote branch', async () => {
    const bare = join(fixture.dir, 'origin.git')
    initBare(bare)
    jj(root, 'describe', '-m', 'review')
    jj(root, 'bookmark', 'create', 'master', '-r', '@')
    writeFile(
      root,
      '.jj/repo/config.toml',
      '[revset-aliases]\n"trunk()" = "bookmarks(exact:\\"master\\")"\n',
    )
    jj(root, 'bookmark', 'create', 'feature/calendar-sync', '-r', '@')
    jj(root, 'git', 'remote', 'add', 'origin', bare)
    jj(root, 'git', 'push', '--bookmark', 'feature/calendar-sync')

    const snapshot = await loadCleanup(repo, [])
    expect(snapshot.bookmarks.map((bookmark) => bookmark.name)).toContain('feature/calendar-sync')

    await applyCleanup(repo, snapshot, selection({ bookmarks: ['feature/calendar-sync'] }))

    const after = await repo.bookmarkList()
    expect(
      after.some(
        (bookmark) => bookmark.name === 'feature/calendar-sync' && bookmark.remote === null,
      ),
    ).toBe(false)
    const refs = gitRefs(root)
    expect(refs).not.toContain('refs/heads/feature/calendar-sync')
    expect(refs).toContain('refs/remotes/origin/feature/calendar-sync')
  })

  test('abandons a commit with no description', async () => {
    jj(root, 'new')
    jj(root, 'new', '-m', 'later')
    const [parent] = await repo.log('@-', 1)
    if (!parent) {
      throw new Error('expected a parent')
    }

    const snapshot = await loadCleanup(repo, [])
    expect(snapshot.undescribed).toContainEqual(
      expect.objectContaining({ commitId: parent.commitId, canAbandon: true }),
    )

    await applyCleanup(repo, snapshot, selection({ undescribed: [parent.commitId] }))

    const after = await loadCleanup(repo, [])
    expect(after.undescribed.some((commit) => commit.commitId === parent.commitId)).toBe(false)
  })

  test('forgets a workspace and deletes its folder only when asked', async () => {
    const kept = join(fixture.dir, 'kept-ws')
    const removed = join(fixture.dir, 'removed-ws')
    await repo.addWorkspace(kept, 'kept', '@')
    await repo.addWorkspace(removed, 'removed', '@')
    writeFile(kept, 'keep.txt', 'stay\n')
    writeFile(removed, 'drop.txt', 'gone\n')

    const snapshot = await loadCleanup(repo, [])
    expect(snapshot.workspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'kept', canDeleteFiles: true }),
        expect.objectContaining({ name: 'removed', canDeleteFiles: true }),
      ]),
    )

    await applyCleanup(
      repo,
      snapshot,
      selection({
        workspaces: ['kept', 'removed'],
        deleteWorkspaceFiles: ['removed'],
      }),
    )

    expect(existsSync(join(kept, 'keep.txt'))).toBe(true)
    expect(existsSync(removed)).toBe(false)
    const names = (await repo.workspaces()).map((workspace) => workspace.name)
    expect(names).not.toContain('kept')
    expect(names).not.toContain('removed')
  })
})
