import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { runsFromInstallScript, scriptLauncherPath } from '../../src/desktop/updateCheck'

const SCRIPT = readFileSync(join(__dirname, '../../scripts/install.sh'), 'utf8')

const CURL = `#!/bin/sh
out=; url=; effective=0
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift ;;
    -w) effective=1; shift ;;
    --proto) shift ;;
    -*) ;;
    *) url=$1 ;;
  esac
  shift
done
if [ "$effective" = 1 ]; then
  echo "https://github.com/samuelba/ukemi/releases/tag/v$LATEST"
  exit 0
fi
file="$RELEASE_DIR/\${url##*/}"
[ -f "$file" ] || exit 22
cp "$file" "$out"
`

const UNAME = `#!/bin/sh
case "$1" in
  -s) echo "$FAKE_OS" ;;
  -m) echo "$FAKE_ARCH" ;;
esac
`

const program = (build: string): string => `#!/bin/sh
# ${build}
`

const sha256 = (content: string | Buffer): string =>
  createHash('sha256').update(content).digest('hex')

describe.skipIf(process.platform === 'win32')('install.sh', () => {
  let root: string
  let home: string
  let script: string
  let scriptText: string
  let releaseDir: string
  let latest: string

  const dataDir = (): string => join(home, '.local/share')
  const appDir = (): string => join(dataDir(), 'ukemi')
  const versionsDir = (): string => join(appDir(), 'versions')
  const current = (): string => join(appDir(), 'current')
  const appProgram = (): string => join(current(), 'ukemi')
  const launcher = (): string => join(appDir(), 'bin/ukemi')
  const legacyAppImage = (): string => join(appDir(), 'Ukemi.AppImage')
  const marker = (): string => join(appDir(), 'install-method')
  const command = (): string => join(home, '.local/bin/ukemi')
  const desktopEntry = (): string => join(dataDir(), 'applications/ukemi.desktop')
  const icon = (size: string): string => join(dataDir(), `icons/hicolor/${size}/apps/ukemi.png`)
  const svgIcon = (): string => join(dataDir(), 'icons/hicolor/scalable/apps/ukemi.svg')
  const installedVersions = (): string[] => readdirSync(versionsDir()).sort()

  function write(path: string, content: string | Buffer, mode = 0o644): void {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, { mode })
  }

  // The app as electron-builder packs it: everything in one top-level folder.
  function appArchive(build: string, { icons = true } = {}): Buffer {
    const dir = mkdtempSync(join(root, 'archive-'))
    const top = `ukemi-jj-${build}`
    write(join(dir, top, 'ukemi'), program(build), 0o755)
    if (icons) {
      write(join(dir, top, 'resources/icon.png'), `png ${build}`)
      write(join(dir, top, 'resources/icon.svg'), `svg ${build}`)
    }
    const archive = join(dir, 'app.tar.gz')
    expect(spawnSync('tar', ['-czf', archive, '-C', dir, top]).status).toBe(0)
    const content = readFileSync(archive)
    rmSync(dir, { recursive: true, force: true })
    return content
  }

  // What the launcher passes to the app, which here prints its arguments one per line.
  function launch(...args: string[]): string[] {
    write(appProgram(), '#!/bin/sh\nprintf "%s\\n" "$@"\n', 0o755)
    const result = spawnSync(launcher(), args, { env: environment({}), encoding: 'utf8' })
    expect(result.status).toBe(0)
    return result.stdout.split('\n').filter(Boolean)
  }

  // A process that runs the program of an installed version, as /proc shows it.
  function markRunning(version: string, pid = 4242): void {
    const exe = join(root, `proc/${pid}/exe`)
    mkdirSync(dirname(exe), { recursive: true })
    rmSync(exe, { force: true })
    symlinkSync(join(versionsDir(), version, 'ukemi'), exe)
  }

  // What earlier versions of the script installed.
  function installAppImage(version: string): void {
    write(legacyAppImage(), 'old AppImage', 0o755)
    write(marker(), `method=script\nversion=${version}\n`)
    mkdirSync(dirname(command()), { recursive: true })
    symlinkSync(legacyAppImage(), command())
    write(desktopEntry(), `Exec=${legacyAppImage()} %U\n`)
    write(icon('128x128'), 'old icon')
  }

  function publish(version: string, assets: Record<string, string | Buffer>): void {
    latest = version
    rmSync(releaseDir, { recursive: true, force: true })
    for (const [name, content] of Object.entries(assets)) {
      write(join(releaseDir, name), content)
    }
    const sums = Object.entries(assets).map(([name, content]) => `${sha256(content)}  ${name}\n`)
    write(join(releaseDir, 'SHA256SUMS'), sums.join(''))
  }

  const publishLinux = (version: string): void =>
    publish(version, { [`Ukemi-${version}-linux-x64.tar.gz`]: appArchive(version) })

  function environment(extra: Record<string, string>): NodeJS.ProcessEnv {
    return {
      PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      HOME: home,
      TMPDIR: root,
      LATEST: latest,
      RELEASE_DIR: releaseDir,
      FAKE_OS: 'Linux',
      FAKE_ARCH: 'x86_64',
      FAKE_ARM64: '0',
      ...extra,
    }
  }

  function run(args: string[] = [], extra: Record<string, string> = {}) {
    return spawnSync('sh', [script, ...args], { env: environment(extra), encoding: 'utf8' })
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ukemi-install-')))
    home = join(root, 'home')
    script = join(root, 'install.sh')
    releaseDir = join(root, 'release')
    latest = '1.0.0'
    scriptText = SCRIPT.replaceAll('/usr/bin/ukemi', `${root}/system/ukemi`)
      .replaceAll('/opt/Ukemi', `${root}/system/Ukemi`)
      .replaceAll(' /Applications', ` ${root}/Applications`)
      .replace('proc=/proc', `proc=${root}/proc`)
      .replace('apparmor_dir=/etc/apparmor.d', `apparmor_dir=${root}/apparmor.d`)
      .replace('tty=/dev/tty', `tty=${root}/tty`)
    mkdirSync(home)
    write(script, scriptText)
    write(join(root, 'bin/curl'), CURL, 0o755)
    write(join(root, 'bin/uname'), UNAME, 0o755)
    write(join(root, 'bin/sysctl'), '#!/bin/sh\necho "$FAKE_ARM64"\n', 0o755)
    write(join(root, 'bin/pgrep'), '#!/bin/sh\nexit 1\n', 0o755)
    write(join(root, 'bin/hdiutil'), '#!/bin/sh\nexit 1\n', 0o755)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  describe('on Linux', () => {
    test('installs the app, command, menu entry, icons and marker when piped to sh', () => {
      publishLinux('1.0.0')

      const result = spawnSync('sh', [], {
        input: scriptText,
        env: environment({}),
        encoding: 'utf8',
      })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Installed Ukemi 1.0.0')
      expect(readlinkSync(current())).toBe('versions/1.0.0')
      expect(readFileSync(appProgram(), 'utf8')).toBe(program('1.0.0'))
      expect(installedVersions()).toEqual(['1.0.0'])
      expect(readlinkSync(command())).toBe(launcher())
      expect(readFileSync(desktopEntry(), 'utf8')).toContain(`Exec=${launcher()} %U`)
      expect(readFileSync(icon('256x256'), 'utf8')).toBe('png 1.0.0')
      expect(readFileSync(svgIcon(), 'utf8')).toBe('svg 1.0.0')
      expect(readFileSync(marker(), 'utf8')).toBe('method=script\nversion=1.0.0\n')
      expect(existsSync(legacyAppImage())).toBe(false)
    })

    // The app finds its install by the layout the script makes.
    test('installs what the app recognises as its install', () => {
      publishLinux('1.0.0')
      run()

      expect(scriptLauncherPath({}, home)).toBe(launcher())
      expect(
        runsFromInstallScript({ platform: 'linux', env: {}, home, exePath: appProgram() }),
      ).toBe(true)
    })

    test('leaves the current version alone unless forced', () => {
      publishLinux('1.0.0')
      run()
      write(appProgram(), 'changed', 0o755)

      expect(run().stdout).toContain('already installed')
      expect(readFileSync(appProgram(), 'utf8')).toBe('changed')

      expect(run(['--force']).stdout).toContain('Reinstalled Ukemi 1.0.0')
      expect(readFileSync(appProgram(), 'utf8')).toBe(program('1.0.0'))
      expect(installedVersions()).toEqual(['1.0.0'])
    })

    test('updates to a newer release and removes the old version', () => {
      publishLinux('1.0.0')
      run()
      publishLinux('1.1.0')

      expect(run().stdout).toContain('Updated Ukemi 1.0.0 → 1.1.0')
      expect(readlinkSync(current())).toBe('versions/1.1.0')
      expect(readFileSync(appProgram(), 'utf8')).toBe(program('1.1.0'))
      expect(installedVersions()).toEqual(['1.1.0'])
      expect(readFileSync(marker(), 'utf8')).toContain('version=1.1.0')
    })

    test('keeps a running version where readlink takes only one file, as in BusyBox', () => {
      const realReadlink = spawnSync('sh', ['-c', 'command -v readlink'], { encoding: 'utf8' })
      write(
        join(root, 'bin/readlink'),
        `#!/bin/sh\n[ $# -eq 1 ] || { echo usage >&2; exit 1; }\nexec ${realReadlink.stdout.trim()} "$1"\n`,
        0o755,
      )
      publishLinux('1.0.0')
      run()
      markRunning('1.0.0')
      markRunning('1.0.0', 4343)
      publishLinux('1.1.0')

      expect(run().status).toBe(0)
      expect(installedVersions()).toEqual(['1.0.0', '1.1.0'])
    })

    test('finishes the install when the app has no icons', () => {
      publish('1.0.0', { 'Ukemi-1.0.0-linux-x64.tar.gz': appArchive('1.0.0', { icons: false }) })

      const result = run()

      expect(result.status).toBe(0)
      expect(result.stderr).toContain('icon')
      expect(readFileSync(marker(), 'utf8')).toContain('version=1.0.0')
      expect(existsSync(svgIcon())).toBe(false)
    })

    test('refuses to install while another install runs', () => {
      publishLinux('1.0.0')
      write(join(appDir(), '.install-lock/pid'), `${process.pid}\n`)

      const result = run()

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('another install of Ukemi is running')
      expect(existsSync(versionsDir())).toBe(false)
    })

    test('takes over the lock of an install that was killed', () => {
      const gone = spawnSync('sh', ['-c', 'echo $$'], { encoding: 'utf8' }).stdout.trim()
      publishLinux('1.0.0')
      write(join(appDir(), '.install-lock/pid'), `${gone}\n`)

      expect(run().status).toBe(0)
      expect(readlinkSync(current())).toBe('versions/1.0.0')
      expect(existsSync(join(appDir(), '.install-lock'))).toBe(false)
    })

    test('keeps a version while it runs and removes it at the next update', () => {
      publishLinux('1.0.0')
      run()
      markRunning('1.0.0')
      publishLinux('1.1.0')

      expect(run().status).toBe(0)
      expect(installedVersions()).toEqual(['1.0.0', '1.1.0'])

      rmSync(join(root, 'proc'), { recursive: true })
      publishLinux('1.2.0')

      expect(run().status).toBe(0)
      expect(installedVersions()).toEqual(['1.2.0'])
    })

    test('removes what an interrupted install left behind', () => {
      publishLinux('1.0.0')
      write(join(versionsDir(), '.0.9.0.new/ukemi'), 'partial')

      expect(run().status).toBe(0)
      expect(installedVersions()).toEqual(['1.0.0'])
    })

    test('installs again when the app was removed by hand', () => {
      publishLinux('1.0.0')
      run()
      rmSync(versionsDir(), { recursive: true })

      const result = run()

      expect(result.stdout).not.toContain('already installed')
      expect(readFileSync(appProgram(), 'utf8')).toBe(program('1.0.0'))
    })

    test('installs nothing when the download does not match its checksum', () => {
      publishLinux('1.0.0')
      write(join(releaseDir, 'Ukemi-1.0.0-linux-x64.tar.gz'), 'tampered')

      const result = run()

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('does not match its checksum')
      expect(existsSync(appDir())).toBe(false)
    })

    test('explains a release without checksums', () => {
      publishLinux('1.0.0')
      rmSync(join(releaseDir, 'SHA256SUMS'))

      const result = run()

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Check your connection')
      expect(result.stderr).toContain('before 0.17.0')
      expect(existsSync(appDir())).toBe(false)
    })

    test('uses the checksums it is given instead of downloading them', () => {
      publishLinux('1.0.0')
      const sums = readFileSync(join(releaseDir, 'SHA256SUMS'), 'utf8')
      rmSync(join(releaseDir, 'SHA256SUMS'))

      expect(run([], { UKEMI_SHA256SUMS: sums }).status).toBe(0)
      expect(readFileSync(appProgram(), 'utf8')).toBe(program('1.0.0'))
    })

    test('installs nothing when the given checksums do not match', () => {
      publishLinux('1.0.0')

      const result = run([], {
        UKEMI_SHA256SUMS: `${'c'.repeat(64)}  Ukemi-1.0.0-linux-x64.tar.gz\n`,
      })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('does not match its checksum')
      expect(existsSync(appDir())).toBe(false)
    })

    test('installs nothing when the given checksums do not list the download', () => {
      publishLinux('1.0.0')

      const result = run([], { UKEMI_SHA256SUMS: `${'c'.repeat(64)}  other\n` })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('is missing from the release')
      expect(existsSync(appDir())).toBe(false)
    })

    test('explains a release that only has an AppImage', () => {
      publish('1.0.0', { 'Ukemi-1.0.0.AppImage': 'AppImage' })

      const result = run()

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Ukemi-1.0.0-linux-x64.tar.gz is missing from the release')
      expect(result.stderr).toContain('only have an AppImage')
    })

    test('installs nothing from an archive that does not unpack', () => {
      publish('1.0.0', { 'Ukemi-1.0.0-linux-x64.tar.gz': '' })

      const result = run()

      expect(result.status).toBe(1)
      expect(existsSync(current())).toBe(false)
    })

    test('picks the arm64 build', () => {
      publish('1.0.0', { 'Ukemi-1.0.0-linux-arm64.tar.gz': appArchive('arm') })

      expect(run([], { FAKE_ARCH: 'aarch64' }).status).toBe(0)
      expect(readFileSync(appProgram(), 'utf8')).toBe(program('arm'))
    })

    test('escapes a percent sign in the menu entry', () => {
      publishLinux('1.0.0')
      const data = join(home, '100%data')

      expect(run([], { XDG_DATA_HOME: data }).status).toBe(0)
      expect(readFileSync(join(data, 'applications/ukemi.desktop'), 'utf8')).toContain(
        `Exec="${join(home, '100%%data/ukemi/bin/ukemi')}" %U`,
      )
    })

    test('refuses to replace a system package', () => {
      publishLinux('1.0.0')
      write(join(root, 'system/ukemi'), '')

      const result = run()

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('system package')
      expect(existsSync(appDir())).toBe(false)
    })

    describe('an AppImage install of earlier versions', () => {
      test('is moved to the unpacked app', () => {
        installAppImage('0.17.0')
        publishLinux('1.0.0')

        const result = run()

        expect(result.status).toBe(0)
        expect(result.stdout).toContain('Replaced the AppImage')
        expect(result.stdout).toContain('Updated Ukemi 0.17.0 → 1.0.0')
        expect(readFileSync(appProgram(), 'utf8')).toBe(program('1.0.0'))
        expect(readlinkSync(command())).toBe(launcher())
        expect(readFileSync(desktopEntry(), 'utf8')).toContain(`Exec=${launcher()} %U`)
        expect(existsSync(icon('128x128'))).toBe(false)
        expect(readFileSync(icon('256x256'), 'utf8')).toBe('png 1.0.0')
      })

      // The old app's Restart button, after it updated itself, starts the AppImage's path.
      test('keeps the AppImage name as a link to the launcher', () => {
        installAppImage('0.17.0')
        publishLinux('1.0.0')
        run()
        publishLinux('1.1.0')
        run()

        expect(readlinkSync(legacyAppImage())).toBe('bin/ukemi')
        expect(readFileSync(legacyAppImage(), 'utf8')).toContain(`exec '${appProgram()}'`)
      })

      test('is moved also when it has the latest version', () => {
        installAppImage('1.0.0')
        publishLinux('1.0.0')

        const result = run()

        expect(result.stdout).not.toContain('already installed')
        expect(result.stdout).toContain('Reinstalled Ukemi 1.0.0')
        expect(readlinkSync(legacyAppImage())).toBe('bin/ukemi')
      })

      test('is uninstalled', () => {
        installAppImage('0.17.0')

        expect(run(['--uninstall']).status).toBe(0)
        expect(existsSync(appDir())).toBe(false)
        expect(existsSync(command())).toBe(false)
        expect(existsSync(desktopEntry())).toBe(false)
        expect(existsSync(icon('128x128'))).toBe(false)
      })
    })

    test('uninstalls everything and keeps an unrelated command of the same name', () => {
      installAppImage('0.17.0')
      publishLinux('1.0.0')
      run()
      rmSync(command())
      write(command(), 'mine')

      expect(run(['--uninstall']).status).toBe(0)
      expect(existsSync(appDir())).toBe(false)
      expect(existsSync(desktopEntry())).toBe(false)
      expect(existsSync(icon('256x256'))).toBe(false)
      expect(existsSync(svgIcon())).toBe(false)
      expect(readFileSync(command(), 'utf8')).toBe('mine')
    })

    test('refuses to uninstall while the app runs', () => {
      publishLinux('1.0.0')
      run()
      markRunning('1.0.0')

      const result = run(['--uninstall'])

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Ukemi is running')
      expect(existsSync(appProgram())).toBe(true)
    })

    describe('where AppArmor limits user namespaces, as on Ubuntu 23.10 and later', () => {
      const profileName = `ukemi-${process.getuid?.() ?? 0}`
      const profile = (): string => join(root, 'apparmor.d', profileName)
      const profileCopy = (): string => join(appDir(), 'apparmor-profile')
      const sudoLog = (): string => join(root, 'sudo.log')
      const answer = (text: string): void => write(join(root, 'tty'), text)

      beforeEach(() => {
        write(join(root, 'proc/sys/kernel/apparmor_restrict_unprivileged_userns'), '1\n')
        mkdirSync(join(root, 'apparmor.d'))
        write(join(root, 'bin/sudo'), `#!/bin/sh\necho "$*" >>"${sudoLog()}"\nexec "$@"\n`, 0o755)
        write(join(root, 'bin/apparmor_parser'), '#!/bin/sh\nexit 0\n', 0o755)
        publishLinux('1.0.0')
      })

      test('installs a profile for every version folder with sudo when the user agrees', () => {
        answer('y\n')

        const result = run()

        expect(result.status).toBe(0)
        expect(result.stdout).toContain('Install it now?')
        const text = readFileSync(profile(), 'utf8')
        expect(text).toContain(
          `profile ${profileName} ${versionsDir()}/*/ukemi flags=(unconfined) {`,
        )
        expect(text).toContain('  userns,')
        expect(readFileSync(sudoLog(), 'utf8')).toContain(`apparmor_parser -r ${profile()}`)
      })

      test('takes an empty answer as yes', () => {
        answer('\n')

        run()

        expect(existsSync(profile())).toBe(true)
      })

      test('does not ask again once the profile is in place', () => {
        answer('y\n')
        run()
        rmSync(sudoLog())

        const result = run(['--force'])

        expect(result.stdout).not.toContain('Install it now?')
        expect(existsSync(sudoLog())).toBe(false)
      })

      test('explains how to install the profile when the user declines', () => {
        answer('n\n')

        const result = run()

        expect(result.status).toBe(0)
        expect(existsSync(profile())).toBe(false)
        expect(existsSync(sudoLog())).toBe(false)
        expect(result.stdout).toContain(
          `sudo install -m 644 ${profileCopy()} ${profile()} && sudo apparmor_parser -r ${profile()}`,
        )
        expect(readlinkSync(current())).toBe('versions/1.0.0')
      })

      test('explains instead of asking when there is no terminal', () => {
        const result = run()

        expect(result.stdout).not.toContain('Install it now?')
        expect(result.stdout).toContain(`sudo apparmor_parser -r ${profile()}`)
      })

      test('never asks during an in-app update, which has no one to answer', () => {
        answer('y\n')

        const sums = readFileSync(join(releaseDir, 'SHA256SUMS'), 'utf8')
        const result = run([], { UKEMI_SHA256SUMS: sums })

        expect(result.stdout).not.toContain('Install it now?')
        expect(existsSync(sudoLog())).toBe(false)
      })

      test('tells how to remove the profile on uninstall', () => {
        answer('y\n')
        run()

        const result = run(['--uninstall'])

        expect(result.status).toBe(0)
        expect(existsSync(appDir())).toBe(false)
        expect(result.stdout).toContain(
          `sudo apparmor_parser -R ${profile()} && sudo rm ${profile()}`,
        )
      })

      test('starts the app without the sandbox while the profile is missing', () => {
        answer('n\n')

        const result = run()

        expect(result.stdout).toContain('Until then Ukemi runs without its sandbox')
        expect(launch('my repo')).toEqual(['--no-sandbox', 'my repo'])
      })

      test('starts the app with the sandbox once the profile is in place', () => {
        answer('y\n')
        run()

        expect(launch('my repo')).toEqual(['my repo'])
      })
    })

    test('needs no AppArmor profile where user namespaces are open', () => {
      write(join(root, 'proc/sys/kernel/apparmor_restrict_unprivileged_userns'), '0\n')
      publishLinux('1.0.0')

      const result = run()

      expect(result.stdout).not.toContain('AppArmor')
      expect(existsSync(join(appDir(), 'apparmor-profile'))).toBe(false)
      expect(launch('my repo')).toEqual(['my repo'])
    })

    test('keeps the launcher working when the app folder is moved by an update', () => {
      publishLinux('1.0.0')
      run()
      publishLinux('1.1.0')
      run()

      expect(launch('-x')).toEqual(['-x'])
      expect(readlinkSync(current())).toBe('versions/1.1.0')
    })
  })

  describe('on macOS', () => {
    const mac = (arch: string, arm64: string) => ({
      FAKE_OS: 'Darwin',
      FAKE_ARCH: arch,
      FAKE_ARM64: arm64,
    })
    const dmgs = {
      'Ukemi-1.0.0-arm64.dmg': 'arm',
      'Ukemi-1.0.0-x64.dmg': 'intel',
    }

    test('picks the arm64 build under Rosetta', () => {
      publish('1.0.0', dmgs)

      expect(run([], mac('x86_64', '1')).stdout).toContain('Downloading Ukemi-1.0.0-arm64.dmg')
    })

    test('picks the x64 build on an Intel Mac', () => {
      publish('1.0.0', dmgs)

      expect(run([], mac('x86_64', '0')).stdout).toContain('Downloading Ukemi-1.0.0-x64.dmg')
    })

    test('installs again when the app was removed by hand', () => {
      publish('1.0.0', dmgs)
      write(marker(), 'method=script\nversion=1.0.0\n')

      const result = run([], mac('arm64', '1'))

      expect(result.stdout).not.toContain('already installed')
      expect(result.stdout).toContain('Downloading Ukemi-1.0.0-arm64.dmg')
    })
  })
})
