import type { EvolutionEntry } from './model'

const FULL_COMMIT_ID = /\b([0-9a-f]{8})[0-9a-f]{32}\b/g

export function sameParents(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((parent) => b.includes(parent))
}

export function canRestoreVersion(entries: readonly EvolutionEntry[], index: number): boolean {
  const current = entries[0]
  const version = entries[index]
  return index > 0 && !!current && !!version && sameParents(version.parents, current.parents)
}

export function operationLabel(operation: string): string {
  return operation.replace(FULL_COMMIT_ID, '$1') || '(unknown operation)'
}
