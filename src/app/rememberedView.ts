import {
  GRAPH_FILTERS,
  HISTORY_DEPTHS,
  type GraphFilter,
  type HistoryDepth,
} from '../../shared/model'
import type { KeyValueStore } from './host'

export interface GraphView {
  filter: GraphFilter
  depth: HistoryDepth
  // A revset the user typed, shown instead of the filter.
  revset?: string
}

const REVSET_HISTORY_LIMIT = 20

// UI state, not a setting: a repository reopens with the filter and depth it was left at.
function viewKey(root: string): string {
  return `ukemi.view:${root}`
}

function isView(value: unknown): value is GraphView {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const { filter, depth, revset } = value as Record<string, unknown>
  return (
    GRAPH_FILTERS.includes(filter as GraphFilter) &&
    HISTORY_DEPTHS.includes(depth as HistoryDepth) &&
    (revset === undefined || (typeof revset === 'string' && revset.trim() !== ''))
  )
}

// `defaults` are the defaultFilter and historyDepth settings of the repository. The view was
// stored with the defaults of its time, and a change of those in the settings wins over it.
export function readView(
  store: KeyValueStore,
  root: string,
  defaults: GraphView,
): GraphView | null {
  const stored = store.get<unknown>(viewKey(root))
  if (!isView(stored)) {
    return null
  }
  const storedDefaults = (stored as { defaults?: unknown }).defaults
  const isCurrent =
    isView(storedDefaults) &&
    storedDefaults.filter === defaults.filter &&
    storedDefaults.depth === defaults.depth
  if (!isCurrent) {
    return null
  }
  const view: GraphView = { filter: stored.filter, depth: stored.depth }
  return stored.revset === undefined ? view : { ...view, revset: stored.revset }
}

export function rememberView(
  store: KeyValueStore,
  root: string,
  view: GraphView,
  defaults: GraphView,
): PromiseLike<void> {
  return store.update(viewKey(root), { ...view, defaults })
}

function historyKey(root: string): string {
  return `ukemi.revsetHistory:${root}`
}

// The revsets typed for a repository, the latest first.
export function readRevsetHistory(store: KeyValueStore, root: string): string[] {
  const stored = store.get<unknown>(historyKey(root))
  return Array.isArray(stored)
    ? stored.filter((entry): entry is string => typeof entry === 'string')
    : []
}

export function rememberRevset(
  store: KeyValueStore,
  root: string,
  revset: string,
): PromiseLike<void> {
  const others = readRevsetHistory(store, root).filter((entry) => entry !== revset)
  return store.update(historyKey(root), [revset, ...others].slice(0, REVSET_HISTORY_LIMIT))
}
