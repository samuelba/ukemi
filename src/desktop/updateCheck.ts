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

// The installers are unsigned and come in several formats, so the app does not install updates
// itself. It points at the release page instead.
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
