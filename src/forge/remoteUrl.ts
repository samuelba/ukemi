export interface RemoteLocation {
  host: string
  projectPath: string
}

const SCP_LIKE = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/

export function parseRemoteUrl(url: string): RemoteLocation | null {
  const trimmed = url.trim()
  let host: string
  let path: string
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      return null
    }
    if (parsed.protocol === 'file:') {
      return null
    }
    host = parsed.hostname
    path = decodeURIComponent(parsed.pathname)
  } else {
    const match = SCP_LIKE.exec(trimmed)
    if (!match?.[1] || !match[2]) {
      return null
    }
    host = match[1]
    path = match[2]
  }
  const projectPath = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
  if (!host || !projectPath.includes('/')) {
    return null
  }
  return { host: host.toLowerCase(), projectPath }
}
