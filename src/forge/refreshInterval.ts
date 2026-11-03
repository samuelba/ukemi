import type { RequestBadge } from '../../shared/protocol'
import { MIN_INTERVAL_MS } from '../util/duration'

export const FORGE_REFRESH_IDLE_MS = 60_000
export const FORGE_REFRESH_PENDING_MS = Math.max(
  MIN_INTERVAL_MS,
  Math.round(FORGE_REFRESH_IDLE_MS / 4),
)

export function forgeRefreshInterval(
  requests: readonly Pick<RequestBadge, 'isMine' | 'ci' | 'state'>[],
  idleMs: number = FORGE_REFRESH_IDLE_MS,
): number {
  const pending = requests.some(
    (request) =>
      request.isMine &&
      request.ci === 'pending' &&
      request.state !== 'merged' &&
      request.state !== 'closed',
  )
  if (!pending) {
    return idleMs
  }
  return Math.min(idleMs, Math.max(MIN_INTERVAL_MS, Math.round(idleMs / 4)))
}

const RATE_LIMIT_BASE_MS = 60_000
const RATE_LIMIT_MAX_MS = 60 * 60_000

// How long to stop refreshing after the forge refused for its rate limit. Without a hint from the
// forge, the pause doubles with each refusal in a row.
export function rateLimitPause(retryAfterMs: number | null, refusalsInRow: number): number {
  if (retryAfterMs !== null) {
    return Math.min(RATE_LIMIT_MAX_MS, Math.max(MIN_INTERVAL_MS, retryAfterMs))
  }
  return Math.min(RATE_LIMIT_MAX_MS, RATE_LIMIT_BASE_MS * 2 ** Math.max(0, refusalsInRow - 1))
}
