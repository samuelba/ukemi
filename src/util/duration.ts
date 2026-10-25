export const MIN_INTERVAL_MS = 10_000
export const DEFAULT_INTERVAL_MS = 600_000

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

const DURATION = /^(?:every\s+)?(\d+(?:\.\d+)?|\.\d+)\s*([smhd])$/i

export function parseDuration(text: string): number | null {
  const match = DURATION.exec(text.trim())
  const amount = match?.[1]
  const unit = match?.[2]?.toLowerCase()
  const unitMs = unit ? UNIT_MS[unit] : undefined
  if (!amount || unitMs === undefined) {
    return null
  }
  const ms = Number(amount) * unitMs
  if (!Number.isFinite(ms) || ms < MIN_INTERVAL_MS) {
    return null
  }
  return ms
}

export function fetchDelay(lastFetch: number | undefined, now: number, intervalMs: number): number {
  if (lastFetch === undefined) {
    return 0
  }
  return Math.max(0, lastFetch + intervalMs - now)
}
