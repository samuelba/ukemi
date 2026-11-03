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
  version: '0.46.0',
  assets: {
    'linux-x64': {
      name: 'jj-v0.46.0-x86_64-unknown-linux-musl.tar.gz',
      sha256: 'fce0271158e665ceb82dc66c5eb95b1728649094e9133074f3b5baece345fc08',
    },
    'linux-arm64': {
      name: 'jj-v0.46.0-aarch64-unknown-linux-musl.tar.gz',
      sha256: '80e28f7501c11e50e0ca06cd6a1fa1d982cff9cc59bfe4411a9d36aa501d867e',
    },
    'darwin-x64': {
      name: 'jj-v0.46.0-x86_64-apple-darwin.tar.gz',
      sha256: '10d941de276c7c5074ef5d395312813b4575f4ce92cb9c0b05738efb90bd3b60',
    },
    'darwin-arm64': {
      name: 'jj-v0.46.0-aarch64-apple-darwin.tar.gz',
      sha256: '43daa37ce0f9716cdf6fb65a29cbcae74a3160aef048cf3cb3d166d41cb4ab58',
    },
    'win32-x64': {
      name: 'jj-v0.46.0-x86_64-pc-windows-msvc.zip',
      sha256: 'c42316b10df04611bc65029a18bcb2d92636edddb6871d511f7bb4233e999b83',
    },
    'win32-arm64': {
      name: 'jj-v0.46.0-aarch64-pc-windows-msvc.zip',
      sha256: 'f6f0552d0e292e3e62aa7fd21f4b15e9b6644d4939db908ed6d6b04b5b0a7907',
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
    const host = hostSpawn(path, ['--version'])
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
