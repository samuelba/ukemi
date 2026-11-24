import type { ForgeKind } from '../../shared/protocol'
import type { Remote } from '../../shared/model'
import { isSshRemoteUrl, parseRemoteUrl, type RemoteLocation } from './remoteUrl'

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
    normalized === 'github.com' ||
    normalized.endsWith('.ghe.com')
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

// SSH host aliases, such as `github-work` in ~/.ssh/config, by the server each stands for.
export type SshAliases = ReadonlyMap<string, string>

const NO_ALIASES: SshAliases = new Map()

// The remote's location, with an SSH alias replaced by the server it stands for.
function remoteLocation(remote: Remote, aliases: SshAliases): RemoteLocation | null {
  const location = parseRemoteUrl(remote.url)
  const server = location && isSshRemoteUrl(remote.url) ? aliases.get(location.host) : undefined
  return location && server ? { ...location, host: server } : location
}

// The hosts of SSH remotes that no forge is known for, which may be aliases.
export function sshAliasCandidates(remotes: readonly Remote[], lists: HostLists): string[] {
  const hosts: string[] = []
  for (const remote of remotes) {
    const location = isSshRemoteUrl(remote.url) ? parseRemoteUrl(remote.url) : null
    if (location && !forgeKindForHost(location.host, lists) && !hosts.includes(location.host)) {
      hosts.push(location.host)
    }
  }
  return hosts
}

export function detectForge(
  remotes: readonly Remote[],
  lists: HostLists,
  aliases: SshAliases = NO_ALIASES,
): ForgeTarget | null {
  for (const remote of orderedRemotes(remotes)) {
    const location = remoteLocation(remote, aliases)
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

export function unknownHosts(
  remotes: readonly Remote[],
  lists: HostLists,
  aliases: SshAliases = NO_ALIASES,
): string[] {
  const hosts: string[] = []
  for (const remote of orderedRemotes(remotes)) {
    const location = remoteLocation(remote, aliases)
    if (!location || forgeKindForHost(location.host, lists) || hosts.includes(location.host)) {
      continue
    }
    hosts.push(location.host)
  }
  return hosts
}
