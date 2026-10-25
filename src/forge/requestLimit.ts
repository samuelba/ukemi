export const DEFAULT_REQUEST_LIMIT = 50
export const MAX_REQUEST_LIMIT = 500
export const REQUEST_PAGE_SIZE = 100

export function clampRequestLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_REQUEST_LIMIT
  }
  return Math.min(MAX_REQUEST_LIMIT, Math.max(1, Math.floor(value)))
}
