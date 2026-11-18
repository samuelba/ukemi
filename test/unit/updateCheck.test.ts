import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  installedByScript,
  installMarkerPath,
  isNewer,
  parseRelease,
  runsFromInstallScript,
  updateNotice,
} from '../../src/desktop/updateCheck'

const release = {
  tag_name: 'v0.9.0',
  html_url: 'https://github.com/samuelba/ukemi/releases/tag/v0.9.0',
}

describe('parseRelease', () => {
  test('reads the version and page of a release', () => {
    expect(parseRelease(release)).toEqual({
      version: '0.9.0',
      url: 'https://github.com/samuelba/ukemi/releases/tag/v0.9.0',
    })
  })

  test('ignores a release that is not a plain version of this repository', () => {
    expect(parseRelease({ ...release, tag_name: 'v0.9.0-beta.1' })).toBeNull()
    expect(parseRelease({ ...release, html_url: 'https://example.com/ukemi' })).toBeNull()
    expect(parseRelease({ message: 'API rate limit exceeded' })).toBeNull()
  })
})

describe('isNewer', () => {
  test('compares the parts as numbers', () => {
    expect(isNewer('0.10.0', '0.9.3')).toBe(true)
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
    expect(isNewer('0.9.0', '0.9.0')).toBe(false)
    expect(isNewer('0.8.9', '0.9.0')).toBe(false)
  })
})

describe('updateNotice', () => {
  const latest = { version: '0.9.0', url: release.html_url }

  test('offers a newer release the user did not skip', () => {
    expect(updateNotice('0.8.0', latest, undefined)).toEqual(latest)
    expect(updateNotice('0.8.0', latest, '0.9.0')).toBeNull()
    expect(updateNotice('0.9.0', latest, undefined)).toBeNull()
    expect(updateNotice('0.8.0', null, undefined)).toBeNull()
  })
})

describe('install script marker', () => {
  test('lives in the XDG data folder', () => {
    expect(installMarkerPath({}, '/home/me')).toBe('/home/me/.local/share/ukemi/install-method')
    expect(installMarkerPath({ XDG_DATA_HOME: '/data' }, '/home/me')).toBe(
      '/data/ukemi/install-method',
    )
  })

  test('tells whether the install script installed the app', () => {
    expect(installedByScript('method=script\nversion=0.17.0\n')).toBe(true)
    expect(installedByScript('method=package\n')).toBe(false)
    expect(installedByScript('')).toBe(false)
  })
})

describe.skipIf(process.platform === 'win32')('runsFromInstallScript', () => {
  let home: string
  let appImage: string
  let macApp: string

  function touch(path: string, content = ''): void {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }

  const writeMarker = (): void =>
    touch(installMarkerPath({}, home), 'method=script\nversion=0.17.0\n')
  const linux = (APPIMAGE?: string) => ({
    platform: 'linux' as const,
    env: { APPIMAGE },
    home,
    exePath: '/tmp/.mount_Ukemi/ukemi',
  })
  const mac = (exePath: string) => ({ platform: 'darwin' as const, env: {}, home, exePath })

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ukemi-update-'))
    appImage = join(home, '.local/share/ukemi/Ukemi.AppImage')
    macApp = join(home, 'Applications/Ukemi.app/Contents/MacOS/Ukemi')
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  test('accepts the AppImage the script installed', () => {
    touch(appImage)
    writeMarker()

    expect(runsFromInstallScript(linux(appImage))).toBe(true)
  })

  test('follows symbolic links to the installed AppImage', () => {
    touch(appImage)
    writeMarker()
    const link = join(home, 'link.AppImage')
    symlinkSync(appImage, link)

    expect(runsFromInstallScript(linux(link))).toBe(true)
  })

  test('rejects a system package that left the marker behind', () => {
    touch(appImage)
    writeMarker()

    expect(runsFromInstallScript(linux(undefined))).toBe(false)
  })

  test('rejects an AppImage from another folder', () => {
    const other = join(home, 'Downloads/Ukemi.AppImage')
    touch(appImage)
    touch(other)
    writeMarker()

    expect(runsFromInstallScript(linux(other))).toBe(false)
  })

  test('rejects the installed AppImage without a marker', () => {
    touch(appImage)

    expect(runsFromInstallScript(linux(appImage))).toBe(false)
  })

  test('accepts the macOS app in the home Applications folder', () => {
    touch(macApp)
    writeMarker()

    expect(runsFromInstallScript(mac(macApp))).toBe(true)
  })

  test('rejects a macOS app started from elsewhere', () => {
    const mounted = join(home, 'Volumes/Ukemi/Ukemi.app/Contents/MacOS/Ukemi')
    touch(macApp)
    touch(mounted)
    writeMarker()

    expect(runsFromInstallScript(mac(mounted))).toBe(false)
  })
})
