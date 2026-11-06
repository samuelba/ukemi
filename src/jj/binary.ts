import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import { flatpakAppId, hostSpawn } from '../util/hostProcess'
import { isVersionAtLeast, parseVersion, type JjVersion } from './parse'

const execFileAsync = promisify(execFile)

export const MIN_JJ_VERSION: JjVersion = { major: 0, minor: 40, patch: 0 }
const VERSION_PROBE_TIMEOUT_MS = 5_000

export interface ReleaseAsset {
  name: string
  sha256: string
}

// The official builds, by Node's `${process.platform}-${process.arch}`. The digests are the ones
// GitHub lists for the release assets.
export const PINNED_RELEASE = {
  version: '0.47.1',
  assets: {
    'linux-x64': {
      name: 'jj-v0.47.1-x86_64-unknown-linux-musl.tar.gz',
      sha256: 'd4b657f622ee50929c8916466dfa3d6a6c17a0a32b50e7b2c793707ec9ebcad7',
    },
    'linux-arm64': {
      name: 'jj-v0.47.1-aarch64-unknown-linux-musl.tar.gz',
      sha256: '0f300e1576de8dabe0a9dedf0b87ae44f8accea5cf54d9a342a51061c1fb1bcd',
    },
    'darwin-x64': {
      name: 'jj-v0.47.1-x86_64-apple-darwin.tar.gz',
      sha256: 'ce7ac70c3b7cf90f2273b4fa62d24576727c5fd55c60dc3820221c05320c7589',
    },
    'darwin-arm64': {
      name: 'jj-v0.47.1-aarch64-apple-darwin.tar.gz',
      sha256: '50129b527f7cd6aef82aebd4bb2b670bb56766adc509ef3279c4327aa3592255',
    },
    'win32-x64': {
      name: 'jj-v0.47.1-x86_64-pc-windows-msvc.zip',
      sha256: '72f9f80bc99d07a7f48d5f219cf5bab91f7e906e4b53f6c827948e646cd1152f',
    },
    'win32-arm64': {
      name: 'jj-v0.47.1-aarch64-pc-windows-msvc.zip',
      sha256: '07f3cf6ed6db95f12be6c79c76aff948689375a9f201f521df4468d0a0c5de85',
    },
  } as Record<string, ReleaseAsset>,
}

export function currentTarget(): string {
  return `${process.platform}-${process.arch}`
}

export type JjSource = 'setting' | 'path' | 'managed'

export interface ResolvedJj {
  path: string
  version: JjVersion
  source: JjSource
}

export type ResolveResult =
  | { kind: 'found'; jj: ResolvedJj }
  | { kind: 'too-old'; path: string; version: JjVersion }
  | { kind: 'missing'; configuredPathInvalid: boolean }

export function managedBinaryPath(storageDir: string, platform: string = process.platform): string {
  return join(storageDir, `jj-${PINNED_RELEASE.version}`, binaryName(platform))
}

// Binaries an earlier Ukemi downloaded for another pinned release, newest first.
export async function staleManagedBinaries(
  storageDir: string,
  platform: string = process.platform,
): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(storageDir)
  } catch {
    return []
  }
  return names
    .map((name) => ({ name, version: /^jj-(\d+\.\d+\.\d+)$/.exec(name)?.[1] }))
    .filter((entry) => entry.version !== undefined && entry.version !== PINNED_RELEASE.version)
    .map((entry) => ({ ...entry, parsed: parseVersion(`jj ${entry.version}`) }))
    .filter((entry) => entry.parsed !== null)
    .sort((a, b) => (isVersionAtLeast(a.parsed!, b.parsed!) ? -1 : 1))
    .map((entry) => join(storageDir, entry.name, binaryName(platform)))
}

// Keeps the newest stale binary, which a window still running the previous Ukemi may be using.
export async function removeOldManagedBinaries(
  storageDir: string,
  platform: string = process.platform,
): Promise<void> {
  const stale = await staleManagedBinaries(storageDir, platform)
  for (const binary of stale.slice(1)) {
    await rm(join(binary, '..'), { recursive: true, force: true }).catch(() => undefined)
  }
}

function binaryName(platform: string): string {
  return platform === 'win32' ? 'jj.exe' : 'jj'
}

export function candidatePaths(pathEnv: string | undefined, home: string): string[] {
  const fromPath = (pathEnv ?? '').split(delimiter).filter((dir) => dir.length > 0)
  const extras = [
    join(home, '.cargo', 'bin'),
    join(home, '.local', 'bin'),
    join(home, 'bin'),
    '/home/linuxbrew/.linuxbrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/snap/bin',
  ]
  const unique = [...new Set([...fromPath, ...extras])]
  return unique.map((dir) => join(dir, 'jj'))
}

export async function probeVersion(path: string): Promise<JjVersion | null> {
  try {
    // From a Flatpak, jj runs on the host, where a path can exist that the sandbox cannot see.
    if (!flatpakAppId()) {
      await access(path, constants.X_OK)
    }
  } catch {
    return null
  }
  return askVersion(path)
}

// The version that `jj --version` reports, for a path or a command name that PATH resolves.
export async function askVersion(command: string): Promise<JjVersion | null> {
  try {
    const host = hostSpawn(command, ['--version'])
    const { stdout } = await execFileAsync(host.command, host.args, {
      env: host.env,
      timeout: VERSION_PROBE_TIMEOUT_MS,
    })
    return parseVersion(stdout)
  } catch {
    return null
  }
}

export async function resolveJj(options: {
  configuredPath: string
  storageDir: string
  searchPaths?: readonly string[]
}): Promise<ResolveResult> {
  const configured = options.configuredPath.trim()
  // In a Flatpak the sandbox's PATH says nothing about the host, so the host looks `jj` up.
  const searchPaths =
    options.searchPaths ??
    (flatpakAppId()
      ? ['jj', ...candidatePaths('', homedir())]
      : candidatePaths(process.env.PATH, homedir()))
  const candidates: Array<{ path: string; source: JjSource }> = [
    ...(configured ? [{ path: configured, source: 'setting' as const }] : []),
    ...searchPaths.map((path) => ({ path, source: 'path' as const })),
    { path: managedBinaryPath(options.storageDir), source: 'managed' },
    // Until the pinned release is downloaded, an earlier download keeps Ukemi working.
    ...(await staleManagedBinaries(options.storageDir)).map((path) => ({
      path,
      source: 'managed' as const,
    })),
  ]

  let tooOld: { path: string; version: JjVersion } | null = null
  for (const candidate of candidates) {
    const version = await probeVersion(candidate.path)
    if (!version) {
      continue
    }
    if (isVersionAtLeast(version, MIN_JJ_VERSION)) {
      return { kind: 'found', jj: { path: candidate.path, version, source: candidate.source } }
    }
    tooOld ??= { path: candidate.path, version }
  }
  if (tooOld) {
    return { kind: 'too-old', ...tooOld }
  }
  return { kind: 'missing', configuredPathInvalid: configured.length > 0 }
}

export function releaseAssetFor(target: string): ReleaseAsset | null {
  return PINNED_RELEASE.assets[target] ?? null
}

export function releaseUrl(asset: ReleaseAsset): string {
  return `https://github.com/jj-vcs/jj/releases/download/v${PINNED_RELEASE.version}/${asset.name}`
}

export function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

export type FetchBytes = (url: string) => Promise<Uint8Array>

export const fetchBytes: FetchBytes = async (url) => {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

export async function downloadJj(
  storageDir: string,
  target = currentTarget(),
  download: FetchBytes = fetchBytes,
): Promise<string> {
  const asset = releaseAssetFor(target)
  if (!asset) {
    throw new Error(`No official jj build for ${target}. Install jj manually.`)
  }
  const platform = target.slice(0, target.indexOf('-'))
  const data = await download(releaseUrl(asset))
  const digest = sha256(data)
  if (digest !== asset.sha256) {
    throw new Error(`Checksum mismatch for ${asset.name}: got ${digest}`)
  }

  await mkdir(storageDir, { recursive: true })
  const workDir = await mkdtemp(join(storageDir, 'download-'))
  try {
    const archive = join(workDir, asset.name)
    await writeFile(archive, data)
    // The tar of macOS and Windows 10 and later also reads the Windows zip.
    const flags = asset.name.endsWith('.zip') ? '-xf' : '-xzf'
    await execFileAsync('tar', [flags, archive, '-C', workDir])
    const extracted = await findFile(workDir, binaryName(platform))
    if (!extracted) {
      throw new Error(`The archive ${asset.name} does not contain a jj binary`)
    }
    const binary = managedBinaryPath(storageDir, platform)
    await mkdir(join(binary, '..'), { recursive: true })
    await chmod(extracted, 0o755)
    await rename(extracted, binary)
    return binary
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

async function findFile(dir: string, name: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  const match = entries.find((entry) => entry.isFile() && entry.name === name)
  return match ? join(match.parentPath, match.name) : null
}
