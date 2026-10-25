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
