import type { ForgeKind } from '../../shared/protocol'
import type { Remote } from '../../shared/model'
import { parseRemoteUrl, type RemoteLocation } from './remoteUrl'

export interface ForgeTarget extends RemoteLocation {
  kind: ForgeKind
  remote: string
}

export interface HostLists {
  gitlabHosts: readonly string[]
  githubHosts: readonly string[]
}

export function forgeKindForHost(host: string, lists: HostLists): ForgeKind | null {
  const normalized = host.toLowerCase()
  if (lists.githubHosts.some((h) => h.toLowerCase() === normalized) || normalized === 'github.com') {
    return 'github'
  }
  if (
    lists.gitlabHosts.some((h) => h.toLowerCase() === normalized) ||
    normalized === 'gitlab.com' ||
    normalized.startsWith('gitlab.')
  ) {
    return 'gitlab'
  }
  return null
}

const REMOTE_PREFERENCE = ['origin', 'upstream']

export function pickRemote(remotes: readonly Remote[]): Remote | null {
  for (const name of REMOTE_PREFERENCE) {
    const match = remotes.find((r) => r.name === name)
    if (match) {
      return match
    }
  }
  return remotes[0] ?? null
}

export function detectForge(remotes: readonly Remote[], lists: HostLists): ForgeTarget | null {
  const remote = pickRemote(remotes)
  const location = remote ? parseRemoteUrl(remote.url) : null
  if (!remote || !location) {
    return null
  }
  const kind = forgeKindForHost(location.host, lists)
  return kind ? { ...location, kind, remote: remote.name } : null
}
