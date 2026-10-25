import type { RequestBadge } from '../../shared/protocol'

export const FORGE_REFRESH_IDLE_MS = 60_000
export const FORGE_REFRESH_PENDING_MS = 15_000

export function forgeRefreshInterval(
  requests: readonly Pick<RequestBadge, 'isMine' | 'ci' | 'state'>[],
): number {
  const pending = requests.some(
    (request) =>
      request.isMine &&
      request.ci === 'pending' &&
      request.state !== 'merged' &&
      request.state !== 'closed',
  )
  return pending ? FORGE_REFRESH_PENDING_MS : FORGE_REFRESH_IDLE_MS
}
