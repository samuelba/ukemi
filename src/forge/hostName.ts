const HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i

export function isSafeHttpsHost(host: string): boolean {
  return HOST.test(host)
}

export function isAllowedForgeUrl(url: string, host: string): boolean {
  if (!isSafeHttpsHost(host)) {
    return false
  }
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === host.toLowerCase()
  } catch {
    return false
  }
}

// The host that serves the API of github.com and of GitHub Enterprise Cloud (*.ghe.com), or null
// for an Enterprise Server, which serves it under /api on its own host.
export function githubApiHost(host: string): string | null {
  const normalized = host.toLowerCase()
  if (normalized === 'github.com') {
    return 'api.github.com'
  }
  return normalized.endsWith('.ghe.com') ? `api.${normalized}` : null
}
