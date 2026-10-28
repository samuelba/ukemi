import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { JjRepo } from '../../src/jj/repo'
import { makeRepo, makeRunner, makeTempDir, writeFile, type Fixture } from '../helpers/jjFixture'

let fixture: Fixture

afterEach(() => fixture.cleanup())

function bareRemote(dir: string, branch = 'main'): string {
  const remote = join(dir, 'remote.git')
  execFileSync('git', ['init', '--bare', '-q', '-b', branch, remote])
  return remote
}

function publishCommit(remote: string, message: string): void {
  const src = join(remote, '..', 'src')
  mkdirSync(src)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: src })
  execFileSync('git', ['config', 'user.email', 'test@ukemi.dev'], { cwd: src })
  execFileSync('git', ['config', 'user.name', 'Ukemi Test'], { cwd: src })
  writeFile(src, 'f.txt', 'f\n')
  execFileSync('git', ['add', 'f.txt'], { cwd: src })
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: src })
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: src })
  execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: src })
}

describe('initNew', () => {
  test('clones an empty folder from a remote that has history', async () => {
    fixture = makeTempDir()
    const remote = bareRemote(fixture.dir)
    publishCommit(remote, 'one')
    const dest = join(fixture.dir, 'dest')
    mkdirSync(dest)

    const result = await JjRepo.initNew(makeRunner(), dest, {
      branch: 'main',
      remoteName: 'upstream',
      remoteUrl: remote,
    })

    expect(result).toEqual({ kind: 'cloned' })
    const repo = makeRepo(dest)
    const commits = await repo.log('all()')
    expect(commits.some((commit) => commit.description.startsWith('one'))).toBe(true)
    expect(await repo.remotes()).toEqual([{ name: 'upstream', url: remote }])
  })

  test('creates a local bookmark and remote when the remote has no commits', async () => {
    fixture = makeTempDir()
    const remote = bareRemote(fixture.dir)
    const dest = join(fixture.dir, 'dest')
    mkdirSync(dest)

    const result = await JjRepo.initNew(makeRunner(), dest, {
      branch: 'main',
      remoteName: 'upstream',
      remoteUrl: remote,
    })

    expect(result).toEqual({ kind: 'created', historyNotDownloaded: false })
    const repo = makeRepo(dest)
    expect(await repo.bookmarkNames('@')).toEqual(['main'])
    expect(await repo.remotes()).toEqual([{ name: 'upstream', url: remote }])
  })

  test('creates a bookmark and no remote when no url is given', async () => {
    fixture = makeTempDir()
    const dest = join(fixture.dir, 'dest')
    mkdirSync(dest)

    const result = await JjRepo.initNew(makeRunner(), dest, {
      branch: 'main',
      remoteName: 'origin',
    })

    expect(result).toEqual({ kind: 'created', historyNotDownloaded: false })
    const repo = makeRepo(dest)
    expect(await repo.bookmarkNames('@')).toEqual(['main'])
    expect(await repo.remotes()).toEqual([])
  })

  test('adds the remote without downloading commits when the folder has files', async () => {
    fixture = makeTempDir()
    const remote = bareRemote(fixture.dir)
    publishCommit(remote, 'remote-commit')
    const dest = join(fixture.dir, 'dest')
    mkdirSync(dest)
    writeFile(dest, 'local.txt', 'local\n')

    const result = await JjRepo.initNew(makeRunner(), dest, {
      branch: 'main',
      remoteName: 'upstream',
      remoteUrl: remote,
    })

    expect(result).toEqual({ kind: 'created', historyNotDownloaded: true })
    const repo = makeRepo(dest)
    const commits = await repo.log('all()')
    expect(commits.some((commit) => commit.description.startsWith('remote-commit'))).toBe(false)
    expect(await repo.bookmarkNames('@')).toEqual(['main'])
    expect(await repo.remotes()).toEqual([{ name: 'upstream', url: remote }])
  })

  test('leaves no repo when the branch is missing on a remote that has commits', async () => {
    fixture = makeTempDir()
    const remote = bareRemote(fixture.dir)
    publishCommit(remote, 'one')
    const dest = join(fixture.dir, 'dest')
    mkdirSync(dest)

    await expect(
      JjRepo.initNew(makeRunner(), dest, {
        branch: 'missing',
        remoteName: 'upstream',
        remoteUrl: remote,
      }),
    ).rejects.toThrow('No matching branches found on remote: missing')
    expect(existsSync(join(dest, '.jj'))).toBe(false)
    expect(existsSync(join(dest, '.git'))).toBe(false)
  })
})
