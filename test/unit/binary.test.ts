import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  PINNED_RELEASE,
  candidatePaths,
  downloadJj,
  managedBinaryPath,
  releaseAssetFor,
  resolveJj,
  sha256,
} from '../../src/jj/binary'
import { isVersionAtLeast, parseVersion } from '../../src/jj/parse'
import { makeTempDir, type Fixture } from '../helpers/jjFixture'

let fixture: Fixture

beforeEach(() => {
  fixture = makeTempDir()
})

afterEach(() => fixture.cleanup())

describe('parseVersion', () => {
  test('parses release and suffixed versions', () => {
    expect(parseVersion('jj 0.46.0-7d382314')).toEqual({ major: 0, minor: 46, patch: 0 })
    expect(parseVersion('jj 0.46.0+visualjj-62cc')).toEqual({ major: 0, minor: 46, patch: 0 })
  })

  test('returns null for unrelated output', () => {
    expect(parseVersion('git version 2.43')).toBeNull()
  })

  test('compares versions', () => {
    const min = { major: 0, minor: 40, patch: 0 }
    expect(isVersionAtLeast({ major: 0, minor: 46, patch: 0 }, min)).toBe(true)
    expect(isVersionAtLeast({ major: 0, minor: 39, patch: 9 }, min)).toBe(false)
    expect(isVersionAtLeast({ major: 1, minor: 0, patch: 0 }, min)).toBe(true)
  })
})

describe('candidatePaths', () => {
  test('puts PATH entries first and adds common install dirs once', () => {
    const paths = candidatePaths('/opt/a:/home/u/.cargo/bin', '/home/u')

    expect(paths[0]).toBe('/opt/a/jj')
    expect(paths.filter((p) => p === '/home/u/.cargo/bin/jj')).toHaveLength(1)
    expect(paths).toContain('/home/u/.local/bin/jj')
  })
})

describe('resolveJj', () => {
  test('prefers a valid configured path', async () => {
    const jjPath = execFileSync('sh', ['-c', 'command -v jj'], { encoding: 'utf8' }).trim()

    const result = await resolveJj({ configuredPath: jjPath, storageDir: fixture.dir })

    expect(result.kind).toBe('found')
    expect(result.kind === 'found' && result.jj.source).toBe('setting')
  })

  test('rejects a jj that is too old', async () => {
    const fake = join(fixture.dir, 'old-jj')
    writeFileSync(fake, '#!/bin/sh\necho "jj 0.20.0"\n', { mode: 0o755 })

    const result = await resolveJj({
      configuredPath: fake,
      storageDir: fixture.dir,
      searchPaths: [],
    })

    expect(result).toEqual({
      kind: 'too-old',
      path: fake,
      version: { major: 0, minor: 20, patch: 0 },
    })
  })

  test('reports a missing jj and an invalid configured path', async () => {
    const result = await resolveJj({
      configuredPath: '/nonexistent/jj',
      storageDir: fixture.dir,
      searchPaths: [],
    })

    expect(result).toEqual({ kind: 'missing', configuredPathInvalid: true })
  })
})

describe('downloadJj', () => {
  test('rejects data with a wrong checksum', async () => {
    const download = async () => new Uint8Array([1, 2, 3])

    await expect(downloadJj(fixture.dir, 'linux-x64', download)).rejects.toThrow(
      'Checksum mismatch',
    )
    expect(existsSync(managedBinaryPath(fixture.dir))).toBe(false)
  })

  test('rejects platforms without an official build', async () => {
    await expect(downloadJj(fixture.dir, 'linux-riscv64')).rejects.toThrow('No official jj build')
    await expect(downloadJj(fixture.dir, 'freebsd-x64')).rejects.toThrow('No official jj build')
  })

  test('extracts the binary when the checksum matches', async () => {
    const staging = join(fixture.dir, 'staging')
    mkdirSync(staging)
    writeFileSync(join(staging, 'jj'), '#!/bin/sh\necho "jj 0.46.0"\n')
    const archive = join(fixture.dir, 'jj.tar.gz')
    execFileSync('tar', ['-czf', archive, '-C', staging, './jj'])
    const data = new Uint8Array(readFileSync(archive))
    const asset = releaseAssetFor('linux-x64')
    if (!asset) {
      throw new Error('missing asset')
    }
    const original = asset.sha256
    PINNED_RELEASE.assets['linux-x64'] = { ...asset, sha256: sha256(data) }
    try {
      const path = await downloadJj(join(fixture.dir, 'store'), 'linux-x64', async () => data)

      expect(execFileSync(path, ['--version'], { encoding: 'utf8' }).trim()).toBe('jj 0.46.0')
    } finally {
      PINNED_RELEASE.assets['linux-x64'] = { ...asset, sha256: original }
    }
  })
})

describe('releaseAssetFor', () => {
  test.each([
    ['linux-x64', 'x86_64-unknown-linux-musl.tar.gz'],
    ['linux-arm64', 'aarch64-unknown-linux-musl.tar.gz'],
    ['darwin-x64', 'x86_64-apple-darwin.tar.gz'],
    ['darwin-arm64', 'aarch64-apple-darwin.tar.gz'],
    ['win32-x64', 'x86_64-pc-windows-msvc.zip'],
    ['win32-arm64', 'aarch64-pc-windows-msvc.zip'],
  ])('picks the official build for %s', (target, suffix) => {
    expect(releaseAssetFor(target)?.name.endsWith(suffix)).toBe(true)
    expect(releaseAssetFor(target)?.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('managedBinaryPath', () => {
  test('names the binary as the platform runs it', () => {
    expect(managedBinaryPath('/store', 'linux').endsWith('jj')).toBe(true)
    expect(managedBinaryPath('/store', 'win32').endsWith('jj.exe')).toBe(true)
  })
})
