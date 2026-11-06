import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { upgradeManagedJj } from '../../src/app/jjSetup'
import {
  PINNED_RELEASE,
  managedBinaryPath,
  removeOldManagedBinaries,
  resolveJj,
  staleManagedBinaries,
} from '../../src/jj/binary'
import { parseVersion } from '../../src/jj/parse'
import { NULL_LOGGER } from '../../src/util/logger'
import { makeTempDir, type Fixture } from '../helpers/jjFixture'

let fixture: Fixture

beforeEach(() => {
  fixture = makeTempDir()
})

afterEach(() => fixture.cleanup())

function installFake(version: string): string {
  const dir = join(fixture.dir, `jj-${version}`)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'jj')
  writeFileSync(path, `#!/bin/sh\necho "jj ${version}"\n`, { mode: 0o755 })
  return path
}

describe('stale managed binaries', () => {
  test('lists earlier downloads newest first, ignoring the pinned release and other folders', async () => {
    const old = installFake('0.44.0')
    const newer = installFake('0.46.0')
    installFake(PINNED_RELEASE.version)
    mkdirSync(join(fixture.dir, 'download-abc'))

    expect(await staleManagedBinaries(fixture.dir, 'linux')).toEqual([newer, old])
  })

  test('falls back to an earlier download until the pinned release is installed', async () => {
    const old = installFake('0.46.0')

    const result = await resolveJj({ configuredPath: '', storageDir: fixture.dir, searchPaths: [] })

    expect(result).toEqual({
      kind: 'found',
      jj: { path: old, version: { major: 0, minor: 46, patch: 0 }, source: 'managed' },
    })
  })

  test('removes all but the newest earlier download', async () => {
    const old = installFake('0.44.0')
    const newer = installFake('0.46.0')

    await removeOldManagedBinaries(fixture.dir, 'linux')

    expect(existsSync(old)).toBe(false)
    expect(existsSync(newer)).toBe(true)
  })
})

describe('upgradeManagedJj', () => {
  test('downloads the pinned release over an earlier download', async () => {
    const old = installFake('0.46.0')
    const jj = { path: old, version: { major: 0, minor: 46, patch: 0 }, source: 'managed' as const }

    const upgraded = await upgradeManagedJj(jj, fixture.dir, NULL_LOGGER, async () =>
      installFake(PINNED_RELEASE.version),
    )

    expect(upgraded).toEqual({
      path: managedBinaryPath(fixture.dir),
      version: parseVersion(`jj ${PINNED_RELEASE.version}`),
      source: 'managed',
    })
  })

  test('leaves jj from PATH, a setting, or the pinned release alone', async () => {
    let downloads = 0
    const download = async () => {
      downloads += 1
      return ''
    }
    const version = { major: 0, minor: 46, patch: 0 }

    await upgradeManagedJj(
      { path: '/usr/bin/jj', version, source: 'path' },
      fixture.dir,
      NULL_LOGGER,
      download,
    )
    await upgradeManagedJj(
      { path: '/opt/jj', version, source: 'setting' },
      fixture.dir,
      NULL_LOGGER,
      download,
    )
    await upgradeManagedJj(
      { path: managedBinaryPath(fixture.dir), version, source: 'managed' },
      fixture.dir,
      NULL_LOGGER,
      download,
    )

    expect(downloads).toBe(0)
  })

  test('keeps the earlier download when the download fails', async () => {
    const old = installFake('0.46.0')
    const jj = { path: old, version: { major: 0, minor: 46, patch: 0 }, source: 'managed' as const }

    const upgraded = await upgradeManagedJj(jj, fixture.dir, NULL_LOGGER, async () => {
      throw new Error('offline')
    })

    expect(upgraded).toBeNull()
    expect(existsSync(old)).toBe(true)
  })
})
