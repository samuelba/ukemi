import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
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
  writeFile(root, 'a.txt', 'one\n')
  jj(root, 'describe', '-m', 'first')
  writeFile(root, 'a.txt', 'two\n')
  writeFile(root, 'b.txt', 'new\n')
  jj(root, 'status')
})

afterEach(() => fixture.cleanup())

describe('evolution', () => {
  test('lists the versions of a change, newest first', async () => {
    const entries = await repo.evolution('@')
    const current = jj(root, 'log', '--no-graph', '-r', '@', '-T', 'commit_id').trim()

    expect(entries[0]?.commitId).toBe(current)
    expect(entries.length).toBeGreaterThanOrEqual(3)
    expect(entries.map((e) => e.operation)).toContain('snapshot working copy')
    expect(entries[0]?.description).toBe('first\n')
  })

  test('lists the files that differ between two versions', async () => {
    const entries = await repo.evolution('@')
    const oldest = entries.at(-1)
    const files = await repo.diffFiles(oldest?.commitId ?? '', entries[0]?.commitId ?? '')

    expect(files.map((f) => [f.path, f.status])).toEqual([
      ['a.txt', 'added'],
      ['b.txt', 'added'],
    ])
  })

  test('shows the interdiff between two versions', async () => {
    const [current, previous] = await repo.evolution('@')
    const patch = await repo.interdiff(previous?.commitId ?? '', current?.commitId ?? '')

    expect(patch).toContain('b.txt')
  })

  test('restores the files of an older version into the change', async () => {
    const entries = await repo.evolution('@')
    const withOne = entries.find((e) => e.operation.startsWith('describe'))

    await repo.restoreVersion(withOne?.commitId ?? '', '@')

    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('one\n')
    expect(jj(root, 'file', 'list', '-r', '@').trim()).toBe('a.txt')
  })
})
