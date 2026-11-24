export interface RemoteLocation {
  host: string
  projectPath: string
}

// A one-letter host is a Windows drive, as in C:\repos/remote.git.
const SCP_LIKE = /^(?:[^@/]+@)?([^:/]{2,}):(?!\/)(.+)$/

// SSH over port 443 for networks that block port 22, see the forges' docs.
const SSH_OVER_HTTPS_HOSTS: Readonly<Record<string, string>> = {
  'ssh.github.com': 'github.com',
  'altssh.gitlab.com': 'gitlab.com',
}

export function isSshRemoteUrl(url: string): boolean {
  const trimmed = url.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return /^(ssh|git\+ssh|ssh\+git):/i.test(trimmed)
  }
  return SCP_LIKE.test(trimmed)
}

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
  const lower = host.toLowerCase()
  return { host: SSH_OVER_HTTPS_HOSTS[lower] ?? lower, projectPath }
}
