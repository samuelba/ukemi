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

    await expect(downloadJj(fixture.dir, 'x64', download)).rejects.toThrow('Checksum mismatch')
    expect(existsSync(managedBinaryPath(fixture.dir))).toBe(false)
  })

  test('rejects unsupported architectures', async () => {
    await expect(downloadJj(fixture.dir, 'riscv64')).rejects.toThrow('No official jj build')
  })

  test('extracts the binary when the checksum matches', async () => {
    const staging = join(fixture.dir, 'staging')
    mkdirSync(staging)
    writeFileSync(join(staging, 'jj'), '#!/bin/sh\necho "jj 0.46.0"\n')
    const archive = join(fixture.dir, 'jj.tar.gz')
    execFileSync('tar', ['-czf', archive, '-C', staging, './jj'])
    const data = new Uint8Array(readFileSync(archive))
    const asset = releaseAssetFor('x64')
    if (!asset) {
      throw new Error('missing asset')
    }
    const original = asset.sha256
    PINNED_RELEASE.assets.x64 = { ...asset, sha256: sha256(data) }
    try {
      const path = await downloadJj(join(fixture.dir, 'store'), 'x64', async () => data)

      expect(execFileSync(path, ['--version'], { encoding: 'utf8' }).trim()).toBe('jj 0.46.0')
    } finally {
      PINNED_RELEASE.assets.x64 = { ...asset, sha256: original }
    }
  })
})
