import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
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

  test('addWorkspace creates a sibling workspace', async () => {
    const wsPath = join(fixture.dir, 'repo-ws')

    await repo.addWorkspace(wsPath, 'second', '@')

    expect(existsSync(join(wsPath, '.jj'))).toBe(true)
    const names = (await repo.workspaces()).map((w) => w.name).sort()
    expect(names).toEqual(['default', 'second'])
  })
})
