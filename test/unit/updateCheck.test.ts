import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  installedByScript,
  installMarkerPath,
  isNewer,
  PACKAGE_EXECUTABLE,
  packageReplaced,
  packageUpdateCommand,
  parseRelease,
  runsFromInstallScript,
  scriptLauncherPath,
  updateNotice,
  updateRoute,
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
  let installed: string
  let macApp: string

  function touch(path: string, content = ''): void {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }

  const writeMarker = (): void =>
    touch(installMarkerPath({}, home), 'method=script\nversion=0.17.0\n')
  const linux = (exePath: string, env: NodeJS.ProcessEnv = {}) => ({
    platform: 'linux' as const,
    env,
    home,
    exePath,
  })
  const mac = (exePath: string) => ({ platform: 'darwin' as const, env: {}, home, exePath })

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ukemi-update-'))
    installed = join(home, '.local/share/ukemi/versions/0.17.0/ukemi')
    macApp = join(home, 'Applications/Ukemi.app/Contents/MacOS/Ukemi')
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  test('accepts a version the script installed', () => {
    touch(installed)
    writeMarker()

    expect(runsFromInstallScript(linux(installed))).toBe(true)
  })

  test('follows symbolic links to the installed version', () => {
    touch(installed)
    writeMarker()
    const current = join(home, '.local/share/ukemi/current')
    symlinkSync('versions/0.17.0', current)

    expect(runsFromInstallScript(linux(join(current, 'ukemi')))).toBe(true)
  })

  test('rejects a system package that left the marker behind', () => {
    const system = join(home, 'opt/Ukemi/ukemi')
    touch(installed)
    touch(system)
    writeMarker()

    expect(runsFromInstallScript(linux(system))).toBe(false)
  })

  test('rejects an AppImage, also from the folder of an older install', () => {
    const mounted = join(home, 'tmp/.mount_UkemiAbc/ukemi')
    const appImage = join(home, '.local/share/ukemi/Ukemi.AppImage')
    touch(mounted)
    touch(appImage)
    writeMarker()

    expect(runsFromInstallScript(linux(mounted, { APPIMAGE: appImage }))).toBe(false)
  })

  test('rejects a program nested deeper in the install folder', () => {
    const nested = join(home, '.local/share/ukemi/versions/0.17.0/resources/ukemi')
    touch(nested)
    writeMarker()

    expect(runsFromInstallScript(linux(nested))).toBe(false)
  })

  test('rejects the installed version without a marker', () => {
    touch(installed)

    expect(runsFromInstallScript(linux(installed))).toBe(false)
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

  describe('updateRoute', () => {
    test('updates in the app when running a version the script installed', () => {
      touch(installed)
      writeMarker()

      expect(updateRoute(linux(installed))).toBe('in-app')
    })

    test('recognises the installed version through a symlinked data folder', () => {
      const real = join(home, 'real/ukemi/versions/0.17.0/ukemi')
      const data = join(home, 'data')
      touch(real)
      symlinkSync(join(home, 'real'), data)
      touch(installMarkerPath({ XDG_DATA_HOME: data }, home), 'method=script\n')

      expect(updateRoute(linux(realpathSync(real), { XDG_DATA_HOME: data }))).toBe('in-app')
    })

    test('points at the script on macOS', () => {
      touch(macApp)
      writeMarker()

      expect(updateRoute(mac(macApp))).toBe('command')
    })

    test('points at the release page when this is not the installed copy', () => {
      const other = join(home, 'Downloads/ukemi/ukemi')
      touch(installed)
      touch(other)
      writeMarker()

      expect(updateRoute(linux(other))).toBe('download')
    })

    test('points at the release page without the script marker', () => {
      touch(installed)

      expect(updateRoute(linux(installed))).toBe('download')
    })

    test('points at the release page from a folder the script set aside to delete', () => {
      writeMarker()
      for (const hidden of ['.0.17.0.new', '.0.17.0.old.123']) {
        const program = join(home, `.local/share/ukemi/versions/${hidden}/ukemi`)
        touch(program)

        expect(updateRoute(linux(program))).toBe('download')
      }
    })
  })

  test('starts the installed version through its launcher', () => {
    expect(scriptLauncherPath({}, '/home/me')).toBe('/home/me/.local/share/ukemi/bin/ukemi')
    expect(scriptLauncherPath({ XDG_DATA_HOME: '/data' }, '/home/me')).toBe('/data/ukemi/bin/ukemi')
  })
})

describe('package installs', () => {
  const sources = readFileSync('packaging/repo/ukemi.sources', 'utf8')
  const repo = readFileSync('packaging/repo/ukemi.repo', 'utf8')
  const APT = '/etc/apt/sources.list.d/ukemi.sources'
  const DNF = '/etc/yum.repos.d/ukemi.repo'
  const packaged = {
    platform: 'linux' as const,
    env: {},
    home: '/home/me',
    exePath: PACKAGE_EXECUTABLE,
  }
  const files =
    (entries: Record<string, string>) =>
    (path: string): string | undefined =>
      entries[path]

  test('update through apt or dnf when the package added its repository', () => {
    expect(packageUpdateCommand(packaged, files({ [APT]: sources }))).toBe(
      'sudo apt update && sudo apt install --only-upgrade ukemi',
    )
    expect(packageUpdateCommand(packaged, files({ [DNF]: repo }))).toBe(
      'sudo dnf upgrade --refresh ukemi',
    )
    expect(updateRoute(packaged, files({ [APT]: sources }))).toBe('package')
    const upgraded = { ...packaged, exePath: `${PACKAGE_EXECUTABLE} (deleted)` }
    expect(packageUpdateCommand(upgraded, files({ [DNF]: repo }))).toBe(
      'sudo dnf upgrade --refresh ukemi',
    )
  })

  test('point at the release page when the repository is turned off or missing', () => {
    const aptOff = `${sources}Enabled: no\n`
    const dnfOff = repo.replace('enabled=1', 'enabled = 0')

    expect(packageUpdateCommand(packaged, files({ [APT]: aptOff }))).toBeNull()
    expect(packageUpdateCommand(packaged, files({ [DNF]: dnfOff }))).toBeNull()
    expect(packageUpdateCommand(packaged, files({}))).toBeNull()
    expect(updateRoute(packaged, files({ [DNF]: dnfOff }))).toBe('download')
  })

  test('ignore the repository for a copy of the app outside the package', () => {
    const elsewhere = { ...packaged, exePath: '/home/me/Downloads/ukemi/ukemi' }

    expect(packageUpdateCommand(elsewhere, files({ [APT]: sources }))).toBeNull()
    expect(
      packageUpdateCommand({ ...packaged, platform: 'darwin' }, files({ [APT]: sources })),
    ).toBeNull()
  })

  test('see that the package manager replaced the running app', () => {
    const link = (target: string) => () => target

    expect(packageReplaced(PACKAGE_EXECUTABLE, link(`${PACKAGE_EXECUTABLE} (deleted)`))).toBe(true)
    expect(packageReplaced(PACKAGE_EXECUTABLE, link(PACKAGE_EXECUTABLE))).toBe(false)
    expect(packageReplaced('/home/me/ukemi', link('/home/me/ukemi (deleted)'))).toBe(false)
    const deleted = `${PACKAGE_EXECUTABLE} (deleted)`
    expect(packageReplaced(deleted, link(deleted))).toBe(true)
    expect(
      packageReplaced(PACKAGE_EXECUTABLE, () => {
        throw new Error('EACCES')
      }),
    ).toBe(false)
  })
})
