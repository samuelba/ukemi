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
  if (
    lists.githubHosts.some((h) => h.toLowerCase() === normalized) ||
    normalized === 'github.com'
  ) {
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

const PREFERRED_REMOTES = ['origin', 'upstream']

function remoteOrder(name: string): number {
  const index = PREFERRED_REMOTES.indexOf(name)
  return index === -1 ? PREFERRED_REMOTES.length : index
}

function orderedRemotes(remotes: readonly Remote[]): Remote[] {
  return remotes
    .map((remote, index) => ({ remote, index }))
    .sort(
      (left, right) =>
        remoteOrder(left.remote.name) - remoteOrder(right.remote.name) || left.index - right.index,
    )
    .map((entry) => entry.remote)
}

export function detectForge(remotes: readonly Remote[], lists: HostLists): ForgeTarget | null {
  for (const remote of orderedRemotes(remotes)) {
    const location = parseRemoteUrl(remote.url)
    if (!location) {
      continue
    }
    const kind = forgeKindForHost(location.host, lists)
    if (kind) {
      return { ...location, kind, remote: remote.name }
    }
  }
  return null
}

export function unknownHosts(remotes: readonly Remote[], lists: HostLists): string[] {
  const hosts: string[] = []
  for (const remote of orderedRemotes(remotes)) {
    const location = parseRemoteUrl(remote.url)
    if (!location || forgeKindForHost(location.host, lists) || hosts.includes(location.host)) {
      continue
    }
    hosts.push(location.host)
  }
  return hosts
}
