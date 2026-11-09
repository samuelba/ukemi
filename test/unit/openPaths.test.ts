import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  droppedPaths,
  folderToOpen,
  foldersToOpen,
  MAX_DROPPED_PATHS,
} from '../../src/desktop/openPaths'
import { type Fixture, initRepo, makeTempDir } from '../helpers/jjFixture'

describe('folderToOpen', () => {
  let fixture: Fixture
  let repo: string

  beforeEach(() => {
    fixture = makeTempDir('ukemi-open-paths-')
    repo = join(fixture.dir, 'repo')
    initRepo(repo)
    mkdirSync(join(repo, 'src', 'deep'), { recursive: true })
    writeFileSync(join(repo, 'src', 'main.ts'), '')
  })

  afterEach(() => fixture.cleanup())

  test('opens a repository root as itself', async () => {
    expect(await folderToOpen(repo)).toBe(repo)
  })

  test('opens a folder inside a repository at its root', async () => {
    expect(await folderToOpen(join(repo, 'src', 'deep'))).toBe(repo)
  })

  test('opens a file inside a repository at its root', async () => {
    expect(await folderToOpen(join(repo, 'src', 'main.ts'))).toBe(repo)
  })

  test('opens a plain folder as itself', async () => {
    const plain = join(fixture.dir, 'plain')
    mkdirSync(plain)
    expect(await folderToOpen(plain)).toBe(plain)
  })

  test('opens nothing for a file outside any repository', async () => {
    const file = join(fixture.dir, 'notes.txt')
    writeFileSync(file, '')
    expect(await folderToOpen(file)).toBeNull()
  })

  test('opens nothing for a path that does not exist', async () => {
    expect(await folderToOpen(join(fixture.dir, 'gone'))).toBeNull()
  })

  test('foldersToOpen keeps the order, drops repeats and lists what it could not open', async () => {
    const gone = join(fixture.dir, 'gone')
    const result = await foldersToOpen([join(repo, 'src'), gone, repo])
    expect(result).toEqual({ folders: [repo], unusable: [gone] })
  })
})

describe('droppedPaths', () => {
  test('accepts a list of absolute paths', () => {
    expect(droppedPaths(['/a', '/b'])).toEqual(['/a', '/b'])
  })

  test('rejects anything but a list of absolute paths', () => {
    expect(droppedPaths('/a')).toBeNull()
    expect(droppedPaths(['/a', 3])).toBeNull()
    expect(droppedPaths(['relative'])).toBeNull()
    expect(droppedPaths([])).toBeNull()
  })

  test('rejects more paths than a drop can hold', () => {
    const paths = Array.from({ length: MAX_DROPPED_PATHS + 1 }, (_, i) => `/p${i}`)
    expect(droppedPaths(paths)).toBeNull()
  })
})
