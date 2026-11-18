import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

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

const appImage = (build: string): string => `#!/bin/sh
# ${build}
[ "$1" = --appimage-extract ] || exit 1
mkdir -p squashfs-root/usr/share/icons/hicolor/256x256/apps
echo icon >squashfs-root/usr/share/icons/hicolor/256x256/apps/ukemi.png
`

const sha256 = (content: string): string => createHash('sha256').update(content).digest('hex')

describe.skipIf(process.platform === 'win32')('install.sh', () => {
  let root: string
  let home: string
  let script: string
  let scriptText: string
  let releaseDir: string
  let latest: string

  const dataDir = (): string => join(home, '.local/share')
  const installedAppImage = (): string => join(dataDir(), 'ukemi/Ukemi.AppImage')
  const marker = (): string => join(dataDir(), 'ukemi/install-method')

  function write(path: string, content: string, mode = 0o644): void {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, { mode })
  }

  function publish(version: string, assets: Record<string, string>): void {
    latest = version
    rmSync(releaseDir, { recursive: true, force: true })
    for (const [name, content] of Object.entries(assets)) {
      write(join(releaseDir, name), content)
    }
    const sums = Object.entries(assets).map(([name, content]) => `${sha256(content)}  ${name}\n`)
    write(join(releaseDir, 'SHA256SUMS'), sums.join(''))
  }

  const publishLinux = (version: string): void =>
    publish(version, { [`Ukemi-${version}.AppImage`]: appImage(version) })

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
    test('installs the app, command, menu entry, icon and marker when piped to sh', () => {
      publishLinux('1.0.0')

      const result = spawnSync('sh', [], {
        input: scriptText,
        env: environment({}),
        encoding: 'utf8',
      })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Installed Ukemi 1.0.0')
      expect(readFileSync(installedAppImage(), 'utf8')).toBe(appImage('1.0.0'))
      expect(readlinkSync(join(home, '.local/bin/ukemi'))).toBe(installedAppImage())
      expect(readFileSync(join(dataDir(), 'applications/ukemi.desktop'), 'utf8')).toContain(
        `Exec=${installedAppImage()} %U`,
      )
      expect(existsSync(join(dataDir(), 'icons/hicolor/256x256/apps/ukemi.png'))).toBe(true)
      expect(readFileSync(marker(), 'utf8')).toBe('method=script\nversion=1.0.0\n')
    })

    test('leaves the current version alone unless forced', () => {
      publishLinux('1.0.0')
      run()
      write(installedAppImage(), 'changed')

      expect(run().stdout).toContain('already installed')
      expect(readFileSync(installedAppImage(), 'utf8')).toBe('changed')

      expect(run(['--force']).stdout).toContain('Reinstalled Ukemi 1.0.0')
      expect(readFileSync(installedAppImage(), 'utf8')).toBe(appImage('1.0.0'))
    })

    test('updates to a newer release', () => {
      publishLinux('1.0.0')
      run()
      publishLinux('1.1.0')

      expect(run().stdout).toContain('Updated Ukemi 1.0.0 → 1.1.0')
      expect(readFileSync(installedAppImage(), 'utf8')).toBe(appImage('1.1.0'))
      expect(readFileSync(marker(), 'utf8')).toContain('version=1.1.0')
    })

    test('installs again when the app was removed by hand', () => {
      publishLinux('1.0.0')
      run()
      rmSync(installedAppImage())

      const result = run()

      expect(result.stdout).not.toContain('already installed')
      expect(existsSync(installedAppImage())).toBe(true)
    })

    test('installs nothing when the download does not match its checksum', () => {
      publishLinux('1.0.0')
      write(join(releaseDir, 'Ukemi-1.0.0.AppImage'), 'tampered')

      const result = run()

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('does not match its checksum')
      expect(existsSync(installedAppImage())).toBe(false)
    })

    test('explains a release without checksums', () => {
      publishLinux('1.0.0')
      rmSync(join(releaseDir, 'SHA256SUMS'))

      const result = run()

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Check your connection')
      expect(result.stderr).toContain('before 0.17.0')
      expect(existsSync(installedAppImage())).toBe(false)
    })

    test('uses the checksums it is given instead of downloading them', () => {
      publishLinux('1.0.0')
      const sums = readFileSync(join(releaseDir, 'SHA256SUMS'), 'utf8')
      rmSync(join(releaseDir, 'SHA256SUMS'))

      expect(run([], { UKEMI_SHA256SUMS: sums }).status).toBe(0)
      expect(readFileSync(installedAppImage(), 'utf8')).toBe(appImage('1.0.0'))
    })

    test('installs nothing when the given checksums do not match', () => {
      publishLinux('1.0.0')

      const result = run([], {
        UKEMI_SHA256SUMS: `${'c'.repeat(64)}  Ukemi-1.0.0.AppImage\n`,
      })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('does not match its checksum')
      expect(existsSync(installedAppImage())).toBe(false)
    })

    test('installs nothing when the given checksums do not list the download', () => {
      publishLinux('1.0.0')

      const result = run([], { UKEMI_SHA256SUMS: `${'c'.repeat(64)}  other\n` })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('is missing from the release')
      expect(existsSync(installedAppImage())).toBe(false)
    })

    test('reports a build missing from the release', () => {
      publish('1.0.0', { 'Ukemi-1.0.0-arm64.AppImage': appImage('1.0.0') })

      const result = run()

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Ukemi-1.0.0.AppImage is missing from the release')
    })

    test('picks the arm64 build', () => {
      publish('1.0.0', { 'Ukemi-1.0.0-arm64.AppImage': appImage('arm') })

      expect(run([], { FAKE_ARCH: 'aarch64' }).status).toBe(0)
      expect(readFileSync(installedAppImage(), 'utf8')).toBe(appImage('arm'))
    })

    test('escapes a percent sign in the menu entry', () => {
      publishLinux('1.0.0')
      const data = join(home, '100%data')

      expect(run([], { XDG_DATA_HOME: data }).status).toBe(0)
      expect(readFileSync(join(data, 'applications/ukemi.desktop'), 'utf8')).toContain(
        `Exec="${join(home, '100%%data/ukemi/Ukemi.AppImage')}" %U`,
      )
    })

    test('refuses to replace a system package', () => {
      publishLinux('1.0.0')
      write(join(root, 'system/ukemi'), '')

      const result = run()

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('system package')
      expect(existsSync(installedAppImage())).toBe(false)
    })

    test('uninstalls and keeps an unrelated command of the same name', () => {
      publishLinux('1.0.0')
      run()
      rmSync(join(home, '.local/bin/ukemi'))
      write(join(home, '.local/bin/ukemi'), 'mine')

      expect(run(['--uninstall']).status).toBe(0)
      expect(existsSync(installedAppImage())).toBe(false)
      expect(existsSync(marker())).toBe(false)
      expect(existsSync(join(dataDir(), 'applications/ukemi.desktop'))).toBe(false)
      expect(existsSync(join(dataDir(), 'icons/hicolor/256x256/apps/ukemi.png'))).toBe(false)
      expect(readFileSync(join(home, '.local/bin/ukemi'), 'utf8')).toBe('mine')
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
