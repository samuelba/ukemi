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
}

// UI state, not a setting: a repository reopens with the filter and depth it was left at.
function viewKey(root: string): string {
  return `ukemi.view:${root}`
}

function isView(value: unknown): value is GraphView {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const { filter, depth } = value as Record<string, unknown>
  return (
    GRAPH_FILTERS.includes(filter as GraphFilter) && HISTORY_DEPTHS.includes(depth as HistoryDepth)
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
  return isCurrent ? { filter: stored.filter, depth: stored.depth } : null
}

export function rememberView(
  store: KeyValueStore,
  root: string,
  view: GraphView,
  defaults: GraphView,
): PromiseLike<void> {
  return store.update(viewKey(root), { ...view, defaults })
}
