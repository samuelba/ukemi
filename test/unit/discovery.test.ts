import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { DEFAULT_EXCLUDES, discoverRepos, findRepoRootUpwards } from '../../src/repo/discovery'
import { makeTempDir, type Fixture } from '../helpers/jjFixture'

let fixture: Fixture

beforeEach(() => {
  fixture = makeTempDir()
})

afterEach(() => fixture.cleanup())

function makeRepoDir(path: string, marker: '.jj' | '.git' = '.jj'): string {
  const root = join(fixture.dir, path)
  mkdirSync(join(root, marker), { recursive: true })
  return root
}

const options = { maxDepth: 4, exclude: DEFAULT_EXCLUDES }

describe('discoverRepos', () => {
  test('finds a repo at the workspace root', async () => {
    const root = makeRepoDir('ws')

    expect(await discoverRepos(root, options)).toEqual([{ root, kind: 'jj' }])
  })

  test('finds a repo nested in subfolders', async () => {
    const root = makeRepoDir('ws/a/b/repo')

    expect(await discoverRepos(join(fixture.dir, 'ws'), options)).toEqual([{ root, kind: 'jj' }])
  })

  test('finds sibling repos in a colcon-style workspace', async () => {
    const a = makeRepoDir('ws/src/alpha')
    const b = makeRepoDir('ws/src/beta')

    const repos = await discoverRepos(join(fixture.dir, 'ws'), options)

    expect(repos).toEqual([
      { root: a, kind: 'jj' },
      { root: b, kind: 'jj' },
    ])
  })

  test('lists git-only repos as init candidates', async () => {
    const root = makeRepoDir('ws/legacy', '.git')

    expect(await discoverRepos(join(fixture.dir, 'ws'), options)).toEqual([{ root, kind: 'git' }])
  })

  test('does not descend into a repo', async () => {
    const outer = makeRepoDir('ws/outer')
    makeRepoDir('ws/outer/vendor/inner')

    expect(await discoverRepos(join(fixture.dir, 'ws'), options)).toEqual([
      { root: outer, kind: 'jj' },
    ])
  })

  test('returns the enclosing repo when the folder is inside one', async () => {
    const root = makeRepoDir('repo')
    const sub = join(root, 'pkg', 'src')
    mkdirSync(sub, { recursive: true })

    expect(await discoverRepos(sub, options)).toEqual([{ root, kind: 'jj' }])
  })

  test('ignores a git repo above the folder, such as a dotfiles repo in home', async () => {
    makeRepoDir('home', '.git')
    const project = makeRepoDir('home/projects/app')

    expect(await discoverRepos(join(fixture.dir, 'home', 'projects'), options)).toEqual([
      { root: project, kind: 'jj' },
    ])
  })

  test('respects the scan depth and excludes', async () => {
    makeRepoDir('ws/1/2/3/4/5/deep')
    makeRepoDir('ws/node_modules/pkg')

    expect(await discoverRepos(join(fixture.dir, 'ws'), options)).toEqual([])
  })
})

describe('findRepoRootUpwards', () => {
  test('finds the closest jj repo above a path', async () => {
    const root = makeRepoDir('x/repo')
    const deep = join(root, 'a', 'b')
    mkdirSync(deep, { recursive: true })

    expect(await findRepoRootUpwards(deep)).toBe(root)
  })

  test('returns null outside of any repo', async () => {
    const plain = join(fixture.dir, 'plain')
    mkdirSync(plain)

    expect(await findRepoRootUpwards(plain)).toBeNull()
  })
})
