import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { JjRepo } from '../../src/jj/repo'
import { leftoverCopies, resolveMovedBookmarks } from '../../src/repo/movedBookmarks'
import { initRepo, jj, makeRepo, makeTempDir, writeFile, type Fixture } from '../helpers/jjFixture'

let fixture: Fixture
let root: string
let other: string
let repo: JjRepo

// Mirrors GitHub: after the bottom request is merged, GitHub rebases the remaining branch itself,
// while the local clone rebases its own copy onto the trunk.
function setUpMovedBranch(options: { remoteExtra?: string; mainOnly?: boolean } = {}): void {
  const bare = join(fixture.dir, 'origin.git')
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', bare])
  root = join(fixture.dir, 'repo')
  initRepo(root)
  repo = makeRepo(root)
  writeFile(root, 'base.txt', 'base\n')
  jj(root, 'describe', '-m', 'base')
  jj(root, 'bookmark', 'create', 'main', '-r', '@')
  jj(root, 'new', '-m', 'seven')
  writeFile(root, 'seven.txt', 'seven\n')
  jj(root, 'bookmark', 'create', '7', '-r', '@')
  jj(root, 'git', 'remote', 'add', 'origin', bare)
  if (options.mainOnly) {
    // What `jj git clone -b main` configures.
    jj(root, 'config', 'set', '--repo', 'remotes.origin.fetch-bookmarks', 'main')
  }
  jj(root, 'git', 'push', '--bookmark', 'main', '--bookmark', '7')

  other = join(fixture.dir, 'other')
  jj(fixture.dir, 'git', 'clone', bare, other)
  jj(other, 'bookmark', 'track', '7@origin')
  jj(other, 'new', 'main', '-m', 'trunk moves')
  writeFile(other, 'trunk.txt', 'trunk\n')
  jj(other, 'bookmark', 'set', 'main', '-r', '@')
  jj(other, 'rebase', '-s', '7', '-d', 'main')
  if (options.remoteExtra) {
    jj(other, 'new', '7', '-m', 'extra')
    writeFile(other, 'extra.txt', options.remoteExtra)
    jj(other, 'bookmark', 'set', '7', '-r', '@')
  }
  jj(other, 'git', 'push', '--bookmark', 'main', '--bookmark', '7')

  jj(root, 'git', 'fetch', '-b', 'main')
  jj(root, 'rebase', '-s', '7', '-d', 'main@origin')
  jj(root, 'describe', '-r', '7', '-m', 'seven (local)')
}

async function conflicted(): Promise<Set<string>> {
  const commits = await repo.log('bookmarks()')
  return new Set(
    commits.flatMap((commit) => commit.localBookmarks.filter((b) => b.conflict).map((b) => b.name)),
  )
}

function remoteHead(name: string): string {
  return execFileSync('git', ['--git-dir', join(fixture.dir, 'origin.git'), 'rev-parse', name], {
    encoding: 'utf8',
  }).trim()
}

beforeEach(() => {
  fixture = makeTempDir()
})

afterEach(() => fixture.cleanup())

describe('fetching stacked branches', () => {
  test('a plain fetch skips branches outside fetch-bookmarks, so the push stays stale', async () => {
    setUpMovedBranch({ mainOnly: true })

    await repo.fetch()

    expect((await conflicted()).has('7')).toBe(false)
    await expect(repo.push(['7'])).rejects.toThrow()
  })

  test('fetching the branches by name sees the remote rewrite', async () => {
    setUpMovedBranch({ mainOnly: true })

    await repo.fetch({ branches: ['7', 'main', 'not-on-the-remote'] })
    const names = await conflicted()

    expect(names.has('7')).toBe(true)
    await resolveMovedBookmarks(repo, names, ['7'])
    await repo.push(['7'])
    const [local] = await repo.commitIds('bookmarks(exact:"7")')
    expect(remoteHead('7')).toBe(local)
  })
})

describe('resolveMovedBookmarks', () => {
  test('push fails on stale info until the remote is fetched and the bookmark resolved', async () => {
    setUpMovedBranch()

    await expect(repo.push(['7'])).rejects.toThrow()

    await repo.fetch()
    const names = await conflicted()
    expect(names.has('7')).toBe(true)

    const result = await resolveMovedBookmarks(repo, names, ['7'])

    expect(result).toMatchObject({ resolved: ['7'], skipped: [] })
    expect(result.replaced).toHaveLength(1)
    await repo.push(['7'])
    const [local] = await repo.commitIds('bookmarks(exact:"7")')
    expect(remoteHead('7')).toBe(local)

    expect(await repo.commitIds('divergent()')).toHaveLength(2)
    await repo.abandon(leftoverCopies(result.replaced))
    expect(await repo.commitIds('divergent()')).toEqual([])
    expect(await repo.commitIds('bookmarks(exact:"7")')).toEqual([local])
  })

  test('keeps a replaced remote copy that is still pointed at', async () => {
    setUpMovedBranch()
    await repo.fetch()
    const result = await resolveMovedBookmarks(repo, await conflicted(), ['7'])

    await repo.abandon(leftoverCopies(result.replaced))

    expect(await repo.commitIds('remote_bookmarks(exact:"7")')).toEqual(result.replaced)
  })

  test('asks before overwriting a remote branch with different content', async () => {
    setUpMovedBranch({ remoteExtra: 'someone else\n' })
    await repo.fetch()
    const names = await conflicted()
    const asked: string[][] = []

    const declined = await resolveMovedBookmarks(repo, names, ['7'], async (branches) => {
      asked.push(branches)
      return false
    })

    expect(asked).toEqual([['7']])
    expect(declined).toEqual({ resolved: [], skipped: ['7'], replaced: [] })
    expect((await conflicted()).has('7')).toBe(true)

    const accepted = await resolveMovedBookmarks(repo, names, ['7'], async () => true)

    expect(accepted).toEqual({ resolved: ['7'], skipped: [], replaced: [] })
    expect((await conflicted()).has('7')).toBe(false)
    await repo.push(['7'])
  })

  test('skips without asking when nothing is conflicted', async () => {
    setUpMovedBranch()
    const asked: string[][] = []

    const result = await resolveMovedBookmarks(repo, new Set(), ['7'], async (branches) => {
      asked.push(branches)
      return true
    })

    expect(result).toEqual({ resolved: [], skipped: [], replaced: [] })
    expect(asked).toEqual([])
  })
})
