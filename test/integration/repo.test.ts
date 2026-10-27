import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { GRAPH_FILTERS } from '../../shared/model'
import { graphRevset } from '../../src/jj/revsets'
import type { JjRepo } from '../../src/jj/repo'
import { initRepo, jj, makeRepo, makeTempDir, writeFile, type Fixture } from '../helpers/jjFixture'

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

async function current() {
  await repo.snapshot()
  const [commit] = await repo.log('@')
  if (!commit) {
    throw new Error('no working copy commit')
  }
  return commit
}

describe('log', () => {
  test('parses the working copy commit with its flags', async () => {
    const commit = await current()

    expect(commit.isWorkingCopy).toBe(true)
    expect(commit.isEmpty).toBe(true)
    expect(commit.isImmutable).toBe(false)
    expect(commit.workingCopies).toEqual([])
    expect(commit.changePrefix.length).toBeGreaterThan(0)
    expect(commit.changeId.startsWith(commit.changePrefix)).toBe(true)
  })

  test('reports bookmarks and parents', async () => {
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'first')
    jj(root, 'bookmark', 'create', 'feature', '-r', '@')
    jj(root, 'new')

    const [child, parent] = await repo.log('@ | @-')

    expect(parent?.localBookmarks).toEqual([{ name: 'feature', synced: true, conflict: false }])
    expect(child?.parents).toEqual([parent?.commitId])
    expect(parent?.description).toBe('first\n')
  })

  test('evaluates every graph revset without errors', async () => {
    for (const filter of GRAPH_FILTERS) {
      for (const depth of ['7d', '30d', '1y', 'all'] as const) {
        const commits = await repo.log(graphRevset(filter, depth))
        expect(commits.some((c) => c.isWorkingCopy)).toBe(true)
      }
    }
  })
})

describe('files', () => {
  test('lists added, modified and removed files', async () => {
    writeFile(root, 'keep.txt', 'v1\n')
    writeFile(root, 'gone.txt', 'x\n')
    jj(root, 'new')
    writeFile(root, 'keep.txt', 'v2\n')
    writeFile(root, 'dir/new file.txt', 'n\n')
    jj(root, 'file', 'list')
    const { rmSync } = await import('node:fs')
    rmSync(join(root, 'gone.txt'))

    const commit = await current()
    const files = await repo.files(commit.commitId)

    expect(files.map((f) => [f.path, f.status])).toEqual([
      ['dir/new file.txt', 'added'],
      ['gone.txt', 'removed'],
      ['keep.txt', 'modified'],
    ])
  })

  test('reads file content at a revision', async () => {
    writeFile(root, 'a.txt', 'old\n')
    jj(root, 'new')
    writeFile(root, 'a.txt', 'new\n')
    const commit = await current()

    const content = await repo.fileContent(commit.parents[0] ?? '', 'a.txt')

    expect(content.toString()).toBe('old\n')
  })
})

describe('mutations', () => {
  test('describe accepts messages that start with a hyphen', async () => {
    const commit = await current()

    await repo.describe(commit.commitId, '-dash title\n\nbody')

    expect((await current()).description).toBe('-dash title\n\nbody\n')
  })

  test('splitFiles moves a file into a new change below', async () => {
    writeFile(root, 'a.txt', 'a\n')
    writeFile(root, 'b.txt', 'b\n')
    jj(root, 'describe', '-m', 'both')
    const commit = await current()

    await repo.splitFiles(commit.commitId, ['a.txt'], 'below')

    const [top, bottom] = await repo.log('@ | @-')
    expect(top?.description).toBe('both\n')
    expect((await repo.files(top?.commitId ?? '')).map((f) => f.path)).toEqual(['b.txt'])
    expect((await repo.files(bottom?.commitId ?? '')).map((f) => f.path)).toEqual(['a.txt'])
  })

  test('splitFiles moves a file into a new change above', async () => {
    writeFile(root, 'a.txt', 'a\n')
    writeFile(root, 'b.txt', 'b\n')
    jj(root, 'describe', '-m', 'both')
    const commit = await current()

    await repo.splitFiles(commit.commitId, ['a.txt'], 'above')

    const [original] = await repo.log(commit.changeId)
    const [above] = await repo.log(`children(${original?.commitId})`)
    expect(original?.description).toBe('both\n')
    expect((await repo.files(original?.commitId ?? '')).map((f) => f.path)).toEqual(['b.txt'])
    expect((await repo.files(above?.commitId ?? '')).map((f) => f.path)).toEqual(['a.txt'])
  })

  test('moveFiles squashes a single file into another change', async () => {
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'target')
    jj(root, 'new', '-m', 'source')
    writeFile(root, 'b.txt', 'b\n')
    writeFile(root, 'c.txt', 'c\n')
    const source = await current()
    const target = source.parents[0] ?? ''

    await repo.moveFiles(source.commitId, target, ['b.txt'])

    const [after] = await repo.log('@-')
    expect((await repo.files(after?.commitId ?? '')).map((f) => f.path)).toEqual(['a.txt', 'b.txt'])
  })

  test('copyFiles leaves the source file and writes it into the target', async () => {
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'base')
    const base = await current()
    jj(root, 'new', '-m', 'target')
    const target = await current()
    jj(root, 'new', base.commitId, '-m', 'source')
    writeFile(root, 'b.txt', 'b\n')
    writeFile(root, 'c.txt', 'c\n')
    const source = await current()

    await repo.copyFiles(source.commitId, target.commitId, ['b.txt'])

    const [sourceAfter] = await repo.log(source.changeId)
    const [targetAfter] = await repo.log(target.changeId)
    expect((await repo.files(sourceAfter?.commitId ?? '')).map((f) => f.path).sort()).toEqual([
      'b.txt',
      'c.txt',
    ])
    expect((await repo.files(targetAfter?.commitId ?? '')).map((f) => f.path).sort()).toEqual([
      'b.txt',
    ])
    expect(await repo.fileContent(sourceAfter?.commitId ?? '', 'b.txt')).toEqual(Buffer.from('b\n'))
    expect(await repo.fileContent(targetAfter?.commitId ?? '', 'b.txt')).toEqual(Buffer.from('b\n'))
  })

  test('copyFiles copies a file into an empty child beside the source', async () => {
    writeFile(root, 'a.txt', 'a\n')
    writeFile(root, 'c.txt', 'c\n')
    jj(root, 'describe', '-m', 'source')
    const source = await current()
    jj(root, 'new')
    const target = await current()
    expect(target.isEmpty).toBe(true)

    await repo.copyFiles(source.commitId, target.commitId, ['a.txt'])

    const [sourceAfter] = await repo.log(source.changeId)
    const [targetAfter] = await repo.log(target.changeId)
    expect((await repo.files(sourceAfter?.commitId ?? '')).map((file) => file.path).sort()).toEqual(
      ['a.txt', 'c.txt'],
    )
    expect((await repo.files(targetAfter?.commitId ?? '')).map((file) => file.path)).toEqual([
      'a.txt',
    ])
    expect(targetAfter?.parents).toEqual(sourceAfter?.parents)
    expect(await repo.fileContent(targetAfter?.commitId ?? '', 'a.txt')).toEqual(Buffer.from('a\n'))
    expect(await repo.fileContent(sourceAfter?.commitId ?? '', 'a.txt')).toEqual(Buffer.from('a\n'))
  })

  test('copyFiles restores both names of a rename', async () => {
    writeFile(root, 'a.txt', 'old\n')
    jj(root, 'describe', '-m', 'base')
    const base = await current()
    jj(root, 'new', '-m', 'target')
    const target = await current()
    jj(root, 'new', base.commitId, '-m', 'source')
    renameSync(join(root, 'a.txt'), join(root, 'b.txt'))
    const source = await current()
    const renamed = (await repo.files(source.commitId)).find((file) => file.path === 'b.txt')
    expect(renamed?.sourcePath).toBe('a.txt')

    await repo.copyFiles(source.commitId, target.commitId, ['a.txt', 'b.txt'])

    const [sourceAfter] = await repo.log(source.changeId)
    const [targetAfter] = await repo.log(target.changeId)
    expect((await repo.files(sourceAfter?.commitId ?? '')).map((file) => file.path)).toEqual([
      'b.txt',
    ])
    expect((await repo.files(targetAfter?.commitId ?? '')).map((file) => file.path)).toEqual([
      'b.txt',
    ])
    expect(await repo.fileContent(targetAfter?.commitId ?? '', 'b.txt')).toEqual(
      Buffer.from('old\n'),
    )
    expect(await repo.fileContent(sourceAfter?.commitId ?? '', 'b.txt')).toEqual(
      Buffer.from('old\n'),
    )
  })

  test('duplicate without a destination copies onto the same parents', async () => {
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'source')
    const source = await current()
    const parent = source.parents[0] ?? ''
    jj(root, 'new')

    await repo.duplicate(source.commitId)

    const [still] = await repo.log(source.commitId)
    expect(still?.parents).toEqual([parent])
    const copies = (await repo.log(`children(${parent})`)).filter(
      (commit) => commit.description === 'source\n',
    )
    expect(copies).toHaveLength(2)
    expect(
      copies.every((commit) => commit.parents.length === 1 && commit.parents[0] === parent),
    ).toBe(true)
  })

  test('duplicate onto a destination makes the copy a child of that commit', async () => {
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'source')
    const source = await current()
    const parent = source.parents[0] ?? ''
    jj(root, 'new', parent, '-m', 'dest')
    writeFile(root, 'b.txt', 'b\n')
    const dest = await current()
    jj(root, 'new')

    await repo.duplicate(source.commitId, dest.commitId)

    const [still] = await repo.log(source.commitId)
    expect(still?.parents).toEqual([parent])
    const copy = (await repo.log(`children(${dest.commitId})`)).find(
      (commit) => commit.description === 'source\n',
    )
    expect(copy?.parents).toEqual([dest.commitId])
  })

  async function family() {
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'source')
    const source = await current()
    const parent = source.parents[0] ?? ''
    jj(root, 'new', parent, '-m', 'dest')
    writeFile(root, 'b.txt', 'b\n')
    const dest = await current()
    jj(root, 'new', '-m', 'child')
    writeFile(root, 'c.txt', 'c\n')
    const child = await current()
    jj(root, 'new', parent, '-m', 'keeper')
    writeFile(root, 'd.txt', 'd\n')
    const keeper = await current()
    jj(root, 'new', parent)
    return { parent, source, dest, child, keeper }
  }

  test('duplicate insert-after parents the copy on the target and moves its child', async () => {
    const { parent, source, dest, child } = await family()

    await repo.duplicate(source.commitId, dest.commitId, 'after')

    const [still] = await repo.log(source.commitId)
    expect(still?.parents).toEqual([parent])
    const copy = (await repo.log(`children(${dest.commitId})`)).find(
      (commit) => commit.description === 'source\n',
    )
    expect(copy?.parents).toEqual([dest.commitId])
    const [movedChild] = await repo.log(child.changeId)
    expect(movedChild?.parents).toEqual([copy?.commitId])
  })

  test('duplicate insert-before parents the target on the copy', async () => {
    const { parent, source, dest } = await family()

    await repo.duplicate(source.commitId, dest.commitId, 'before')

    const [still] = await repo.log(source.commitId)
    expect(still?.parents).toEqual([parent])
    const [movedDest] = await repo.log(dest.changeId)
    const [copy] = await repo.log(movedDest?.parents[0] ?? 'none()')
    expect(copy?.description).toBe('source\n')
    expect(copy?.commitId).not.toBe(source.commitId)
    expect(copy?.parents).toEqual([parent])
    expect(movedDest?.parents).toEqual([copy?.commitId])
  })

  test('rebase insert-after moves the source onto the target and the child onto the source', async () => {
    const { parent, source, dest, child, keeper } = await family()

    await repo.rebase(source.commitId, dest.commitId, 'source', 'after')

    const [movedSource] = await repo.log(source.changeId)
    const [movedChild] = await repo.log(child.changeId)
    const [stillDest] = await repo.log(dest.commitId)
    const [stillKeeper] = await repo.log(keeper.commitId)
    expect(stillDest?.parents).toEqual([parent])
    expect(stillKeeper?.parents).toEqual([parent])
    expect(movedSource?.parents).toEqual([dest.commitId])
    expect(movedChild?.parents).toEqual([movedSource?.commitId])
  })

  test('rebase insert-before parents the target on the source and leaves the original parent', async () => {
    const { parent, source, dest, child, keeper } = await family()

    await repo.rebase(source.commitId, dest.commitId, 'source', 'before')

    const [movedSource] = await repo.log(source.changeId)
    const [movedDest] = await repo.log(dest.changeId)
    const [movedChild] = await repo.log(child.changeId)
    const [stillKeeper] = await repo.log(keeper.commitId)
    expect(movedSource?.parents).toEqual([parent])
    expect(movedDest?.parents).toEqual([movedSource?.commitId])
    expect(movedChild?.parents).toEqual([movedDest?.commitId])
    expect(stillKeeper?.parents).toEqual([parent])
  })

  test('squashIntoParent uses the combined message', async () => {
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'parent')
    jj(root, 'new', '-m', 'child')
    writeFile(root, 'b.txt', 'b\n')
    const child = await current()

    await repo.squashIntoParent(child.commitId, 'parent\n\nchild')

    const [merged] = await repo.log('@-')
    expect(merged?.description).toBe('parent\n\nchild\n')
  })

  test('restoreFiles discards changes to one file', async () => {
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'new')
    writeFile(root, 'a.txt', 'changed\n')
    const commit = await current()

    await repo.restoreFiles(commit.commitId, ['a.txt'])

    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('a\n')
  })

  test('undo reverts the last operation', async () => {
    const commit = await current()
    await repo.describe(commit.commitId, 'temp')

    await repo.undo()

    expect((await current()).description).toBe('')
  })

  test('push and fetch work against a local bare remote', async () => {
    const remote = join(fixture.dir, 'remote.git')
    execFileSync('git', ['init', '--bare', '-q', remote])
    jj(root, 'git', 'remote', 'add', 'origin', remote)
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'shared')
    const commit = await current()
    await repo.setBookmark('main', commit.commitId)

    await repo.push('main')
    await repo.fetch()

    const [pushed] = await repo.log('@-')
    expect(pushed?.isPushed).toBe(true)
    expect(pushed?.isImmutable).toBe(true)
    expect(pushed?.remoteBookmarks).toEqual([{ name: 'main', remote: 'origin', tracked: true }])
    expect(await repo.trunkBookmark()).toBe('main')
    expect(await repo.remotes()).toEqual([{ name: 'origin', url: remote }])
  })

  test('newChange on trunk() parents the working copy on the trunk commit', async () => {
    const remote = join(fixture.dir, 'remote.git')
    execFileSync('git', ['init', '--bare', '-q', remote])
    jj(root, 'git', 'remote', 'add', 'origin', remote)
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'shared')
    const trunk = await current()
    await repo.setBookmark('main', trunk.commitId)
    await repo.push('main')
    await repo.fetch()
    jj(root, 'new', '-m', 'side')
    writeFile(root, 'b.txt', 'b\n')

    await repo.newChange(['trunk()'])

    const workingCopy = await current()
    expect(workingCopy.commitId).not.toBe(trunk.commitId)
    expect(workingCopy.parents).toEqual([trunk.commitId])
    expect(workingCopy.isEmpty).toBe(true)
  })

  test('push with names pushes only those bookmarks', async () => {
    const remote = join(fixture.dir, 'remote.git')
    execFileSync('git', ['init', '--bare', '-q', remote])
    jj(root, 'git', 'remote', 'add', 'origin', remote)
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'first')
    jj(root, 'bookmark', 'set', 'one', '-r', '@')
    jj(root, 'new', '-m', 'second')
    jj(root, 'bookmark', 'set', 'two', '-r', '@')
    jj(root, 'bookmark', 'set', 'three', '-r', '@')

    await repo.push(['one', 'two'])

    expect([...(await repo.pushedBookmarkNames())].sort()).toEqual(['one', 'two'])
  })

  test('push with no names publishes new bookmarks and leaves tags local', async () => {
    const remote = join(fixture.dir, 'remote.git')
    execFileSync('git', ['init', '--bare', '-q', remote])
    jj(root, 'git', 'remote', 'add', 'origin', remote)
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'first')
    jj(root, 'bookmark', 'set', 'feature/one', '-r', '@')
    jj(root, 'new', '-m', 'second')
    jj(root, 'bookmark', 'set', 'two', '-r', '@')
    jj(root, 'bookmark', 'set', 'three', '-r', '@')
    jj(root, 'tag', 'set', 'v1', '-r', '@')

    await repo.push()

    const refs = execFileSync('git', ['ls-remote', remote], { encoding: 'utf8' })
    expect(refs).toContain('refs/heads/feature/one')
    expect(refs).toContain('refs/heads/two')
    expect(refs).toContain('refs/heads/three')
    expect(refs).not.toContain('refs/tags/v1')
  })

  test('push with no names moves a tracked bookmark and keeps a deleted one', async () => {
    const remote = join(fixture.dir, 'remote.git')
    execFileSync('git', ['init', '--bare', '-q', remote])
    jj(root, 'git', 'remote', 'add', 'origin', remote)
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'first')
    jj(root, 'bookmark', 'set', 'tracked', '-r', '@')
    jj(root, 'bookmark', 'set', 'gone', '-r', '@')
    await repo.push(['tracked', 'gone'])
    await repo.deleteBookmark('gone')
    jj(root, 'new', '-m', 'second')
    writeFile(root, 'b.txt', 'b\n')
    jj(root, 'bookmark', 'set', 'tracked', '-r', '@')
    const moved = (await repo.log('tracked'))[0]?.commitId

    await repo.push()

    const remoteTracked = (await repo.bookmarkList()).find(
      (row) => row.name === 'tracked' && row.remote === 'origin',
    )
    expect(remoteTracked?.commitId).toBe(moved)
    expect([...(await repo.pushedBookmarkNames())].sort()).toEqual(['gone', 'tracked'])
  })

  test('addWorkspace creates a sibling workspace', async () => {
    const wsPath = join(fixture.dir, 'repo-ws')

    await repo.addWorkspace(wsPath, 'second', '@')

    expect(existsSync(join(wsPath, '.jj'))).toBe(true)
    const names = (await repo.workspaces()).map((w) => w.name).sort()
    expect(names).toEqual(['default', 'second'])
  })

  test('snapshotWorkspace records a file edited in another workspace', async () => {
    const wsPath = join(fixture.dir, 'repo-other')
    await repo.addWorkspace(wsPath, 'other', '@')
    writeFile(wsPath, 'note.txt', 'from the other workspace\n')

    const before = (await repo.workspaces()).find((workspace) => workspace.name === 'other')
    expect(before?.isEmpty).toBe(true)

    await repo.snapshotWorkspace(wsPath)

    const after = (await repo.workspaces()).find((workspace) => workspace.name === 'other')
    expect(after?.isEmpty).toBe(false)
    expect(after?.changedFiles).toBe(1)
    expect(after?.description).toBe('')
  })
})

describe('bookmark rename and untrack', () => {
  test('renameBookmark keeps the target under the new name', async () => {
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'named')
    const commit = await current()
    await repo.setBookmark('old', commit.commitId)

    await repo.renameBookmark('old', 'new')

    const local = (await repo.bookmarkList()).filter((bookmark) => bookmark.remote === null)
    expect(local.map((bookmark) => bookmark.name)).toEqual(['new'])
    expect(local[0]?.commitId).toBe(commit.commitId)
  })

  test('untrackBookmark stops tracking a pushed remote bookmark', async () => {
    const remote = join(fixture.dir, 'remote.git')
    execFileSync('git', ['init', '--bare', '-q', remote])
    jj(root, 'git', 'remote', 'add', 'origin', remote)
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'shared')
    const commit = await current()
    await repo.setBookmark('main', commit.commitId)
    await repo.push('main')

    await repo.untrackBookmark('main', 'origin')

    const tracked = (await repo.bookmarkList()).find(
      (bookmark) => bookmark.name === 'main' && bookmark.remote === 'origin',
    )
    expect(tracked?.tracked).toBe(false)
  })

  test('trunkBookmark prefers main when another bookmark sits on the trunk commit', async () => {
    const remote = join(fixture.dir, 'remote.git')
    execFileSync('git', ['init', '--bare', '-q', remote])
    jj(root, 'git', 'remote', 'add', 'origin', remote)
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'shared')
    const commit = await current()
    await repo.setBookmark('feature', commit.commitId)
    await repo.setBookmark('main', commit.commitId)
    await repo.push('main')

    expect(await repo.trunkBookmark()).toBe('main')
  })
})
