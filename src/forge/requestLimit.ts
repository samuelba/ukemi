export const DEFAULT_REQUEST_LIMIT = 50
export const MAX_REQUEST_LIMIT = 500
// Requests read per head branch: a branch rarely has more than its current one and a few old ones.
export const REQUESTS_PER_BRANCH = 10
// Head branches per GitHub GraphQL query.
export const GITHUB_BRANCHES_PER_QUERY = 20
// GitLab calls of one kind, such as lookups by head branch, that run at once.
export const GITLAB_CONCURRENCY = 4

export function clampRequestLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_REQUEST_LIMIT
  }
  return Math.min(MAX_REQUEST_LIMIT, Math.max(1, Math.floor(value)))
}
