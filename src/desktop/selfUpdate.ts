import { spawn } from 'node:child_process'
import { checkReleaseFile, verifiedReleaseSums } from './releaseVerify'

const DOWNLOAD_BASE = 'https://github.com/samuelba/ukemi/releases/download'
const INSTALLER = 'install.sh'
const SUMS = 'SHA256SUMS'
const SIGNATURE = `${SUMS}.minisig`
// The script and the checksums are a few KiB; anything far larger is not them.
const MAX_DOWNLOAD_BYTES = 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 30_000
// The installer downloads the whole AppImage.
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000
const MAX_STDERR_CHARS = 64 * 1024
const INSTALLER_ERROR_PREFIX = 'ukemi install: '
const INHERITED_ENV = ['HOME', 'XDG_DATA_HOME', 'XDG_BIN_HOME', 'TMPDIR', 'LANG', 'LC_ALL'] as const
const APPIMAGE_ENV = ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD']
const MOUNT_LISTS = ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'GSETTINGS_SCHEMA_DIR']
const RELAUNCH_WAIT_STEPS = 300

interface PreparedUpdate {
  script: Uint8Array
  sums: string
}

interface PrepareOptions {
  fetch?: typeof fetch
  publicKey?: string
}

async function readLimited(response: Response, name: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body?.getReader()
  for (let read = await reader?.read(); read && !read.done; read = await reader?.read()) {
    size += read.value.byteLength
    if (size > MAX_DOWNLOAD_BYTES) {
      await reader?.cancel()
      throw new Error(`${name} is too large`)
    }
    chunks.push(read.value)
  }
  return Buffer.concat(chunks)
}

async function download(fetcher: typeof fetch, base: string, name: string): Promise<Uint8Array> {
  const response = await fetcher(`${base}/${name}`, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`cannot download ${name}: HTTP ${response.status}`)
  }
  return readLimited(response, name)
}

// Nothing from the release is trusted until it matches the checksums signed with the release key.
export async function prepareUpdate(
  version: string,
  options: PrepareOptions = {},
): Promise<PreparedUpdate> {
  const fetcher = options.fetch ?? fetch
  const base = `${DOWNLOAD_BASE}/v${version}`
  const get = (name: string) => download(fetcher, base, name)
  const [sumsFile, signature, script] = await Promise.all([
    get(SUMS),
    get(SIGNATURE),
    get(INSTALLER),
  ])
  const decoder = new TextDecoder()
  const sums = verifiedReleaseSums(sumsFile, decoder.decode(signature), version, options.publicKey)
  checkReleaseFile(sums, INSTALLER, script)
  return { script, sums: decoder.decode(sumsFile) }
}

// An AppImage runs with its mount on PATH and its libraries on LD_LIBRARY_PATH, which must not
// reach the installer or the new AppImage it starts. So only what the script needs is passed.
export function installerEnv(
  env: NodeJS.ProcessEnv,
  version: string,
  sums: string,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const name of INHERITED_ENV) {
    const value = env[name]
    if (value) {
      result[name] = value
    }
  }
  const path = withoutMount(env.PATH, env.APPDIR)
  if (path) {
    result.PATH = path
  }
  return { ...result, UKEMI_VERSION: version, UKEMI_SHA256SUMS: sums }
}

function withoutMount(list: string | undefined, mount: string | undefined): string {
  return (list ?? '')
    .split(':')
    .filter((entry) => !mount || (entry !== mount && !entry.startsWith(`${mount}/`)))
    .join(':')
}

// The new AppImage sets these again from its own mount, so the old mount's values must go.
export function relaunchEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || APPIMAGE_ENV.includes(name)) {
      continue
    }
    const kept = MOUNT_LISTS.includes(name) ? withoutMount(value, env.APPDIR) : value
    if (kept) {
      result[name] = kept
    }
  }
  return result
}

// Electron's app.relaunch() starts the new process with no_new_privs, which stops the setuid
// fusermount from mounting the new AppImage. The new instance also has to wait for this one to
// exit, or the single-instance lock hands its launch back to the instance that is quitting.
export function relaunchAppImage(appImage: string, pid: number, env: Record<string, string>): void {
  const script = `
    i=0
    while kill -0 "$1" 2>/dev/null; do
      i=$((i + 1))
      [ "$i" -le ${RELAUNCH_WAIT_STEPS} ] || exit 1
      sleep 0.1
    done
    exec "$2"
  `
  const child = spawn('sh', ['-c', script, 'sh', String(pid), appImage], {
    env,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

function failureReason(stderr: string, code: number | null, signal: string | null): string {
  const line = stderr
    .split('\n')
    .reverse()
    .find((candidate) => candidate.startsWith(INSTALLER_ERROR_PREFIX))
  if (line) {
    return line.slice(INSTALLER_ERROR_PREFIX.length)
  }
  return signal
    ? `the installer was stopped by ${signal}`
    : `the installer exited with code ${code}`
}

export function runInstaller(update: PreparedUpdate, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-s'], {
      env,
      stdio: ['pipe', 'ignore', 'pipe'],
      timeout: INSTALL_TIMEOUT_MS,
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_STDERR_CHARS)
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(failureReason(stderr, code, signal)))
      }
    })
    // An installer that exits early closes the pipe; `close` above reports that.
    child.stdin.on('error', () => undefined)
    child.stdin.end(update.script)
  })
}
