// The note on request badges that a failed refresh left from an earlier one.
export function staleRequestsNote(refreshError: string): string {
  return `Not updated: ${refreshError}. Shown from the last successful refresh.`
}
