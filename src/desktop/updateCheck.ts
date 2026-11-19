import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'

// Whether the app asks GitHub for a newer release, at start and once a day.
export const CHECK_FOR_UPDATES = 'desktop.checkForUpdates'
// The version the user chose to skip, in state.json.
export const SKIPPED_UPDATE = 'skippedUpdate'

const LATEST_RELEASE_URL = 'https://api.github.com/repos/samuelba/ukemi/releases/latest'
const RELEASE_PAGE_PREFIX = 'https://github.com/samuelba/ukemi/releases/'
const REQUEST_TIMEOUT_MS = 10_000
const VERSION = /^v?(\d+\.\d+\.\d+)$/

export interface Release {
  version: string
  // The release page, where the user picks the installer for their system.
  url: string
}

const releaseSchema = z.object({ tag_name: z.string(), html_url: z.string() })

export function parseRelease(body: unknown): Release | null {
  const parsed = releaseSchema.safeParse(body)
  if (!parsed.success || !parsed.data.html_url.startsWith(RELEASE_PAGE_PREFIX)) {
    return null
  }
  const version = VERSION.exec(parsed.data.tag_name)?.[1]
  return version ? { version, url: parsed.data.html_url } : null
}

export function isNewer(candidate: string, current: string): boolean {
  const a = candidate.split('.').map(Number)
  const b = current.split('.').map(Number)
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) {
      return difference > 0
    }
  }
  return false
}

export function updateNotice(
  current: string,
  latest: Release | null,
  skipped: string | undefined,
): Release | null {
  if (!latest || latest.version === skipped || !isNewer(latest.version, current)) {
    return null
  }
  return latest
}

export const INSTALL_COMMAND = 'curl -fsSL https://samuelba.dev/ukemi/install.sh | sh'

export interface RunningApp {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: string
  exePath: string
}

// scripts/install.sh keeps its marker here and, on Linux, the app: each version unpacked in
// versions/<version>, and `current` linking to the installed one.
function scriptInstallFolder(env: NodeJS.ProcessEnv, home: string): string {
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'ukemi')
}

// scripts/install.sh writes this file. Running the script again updates the app.
export function installMarkerPath(env: NodeJS.ProcessEnv, home: string): string {
  return join(scriptInstallFolder(env, home), 'install-method')
}

export function installedByScript(marker: string): boolean {
  return /^method=script$/m.test(marker)
}

// What starts the installed version on Linux, also after an update replaced the running one. It
// adds --no-sandbox where AppArmor would stop the sandbox.
export function scriptLauncherPath(env: NodeJS.ProcessEnv, home: string): string {
  return join(scriptInstallFolder(env, home), 'bin', 'ukemi')
}

function isInstalledCopy({ platform, env, home, exePath }: RunningApp): boolean {
  const actual = realpathSync(exePath)
  if (platform === 'darwin') {
    return ['/Applications', join(home, 'Applications')]
      .map((folder) => join(folder, 'Ukemi.app', 'Contents', 'MacOS', 'Ukemi'))
      .some((path) => existsSync(path) && realpathSync(path) === actual)
  }
  // Throws, so the caller answers false, when there is no versions folder. Hidden folders are
  // install.sh's staging and set-aside copies, which it deletes.
  const versions = realpathSync(join(scriptInstallFolder(env, home), 'versions'))
  return dirname(dirname(actual)) === versions && !basename(dirname(actual)).startsWith('.')
}

// The marker outlives a switch to a system package, so this app must also be the installed copy.
export function runsFromInstallScript(running: RunningApp): boolean {
  try {
    return (
      isInstalledCopy(running) &&
      installedByScript(readFileSync(installMarkerPath(running.env, running.home), 'utf8'))
    )
  } catch {
    return false
  }
}

export type UpdateRoute = 'in-app' | 'command' | 'download'

// The app installs an update itself only when it runs as the copy install.sh put in place.
// macOS is left to the command, because install.sh cannot replace a running app there.
export function updateRoute(running: RunningApp): UpdateRoute {
  if (!runsFromInstallScript(running)) {
    return 'download'
  }
  return running.platform === 'linux' ? 'in-app' : 'command'
}

export async function latestRelease(): Promise<Release | null> {
  const response = await fetch(LATEST_RELEASE_URL, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return parseRelease(await response.json())
}
