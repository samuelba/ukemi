import type { GraphFilter, SavedRevset } from '../../../shared/model'
import { findSavedRevset } from '../../../shared/savedRevsets'

// Option values of the filter dropdown besides the filter ids.
export const CUSTOM_FILTER = 'custom'
export const EDIT_SAVED_FILTER = 'editSaved'
const SAVED_PREFIX = 'saved:'

export function savedFilterValue(index: number): string {
  return `${SAVED_PREFIX}${index}`
}

// The saved revset an option value names, if it names one.
export function savedFromValue(
  value: string,
  saved: readonly SavedRevset[],
): SavedRevset | undefined {
  if (!value.startsWith(SAVED_PREFIX)) {
    return undefined
  }
  return saved[Number(value.slice(SAVED_PREFIX.length))]
}

// The option the dropdown shows: a revset that is saved shows by its name, any other revset as
// "Revset…", and without a revset the filter.
export function filterValue(
  graph: { filter: GraphFilter; revset: string | null },
  saved: readonly SavedRevset[],
): string {
  if (graph.revset === null) {
    return graph.filter
  }
  const match = findSavedRevset(saved, graph.revset)
  return match ? savedFilterValue(saved.indexOf(match)) : CUSTOM_FILTER
}
