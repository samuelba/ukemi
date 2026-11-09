import type { GraphFilter, SavedRevset } from '../../../shared/model'
import type { GraphState } from '../../../shared/protocol'
import { postMessage } from '../shared/hostApi'
import {
  CUSTOM_FILTER,
  EDIT_SAVED_FILTER,
  filterValue,
  savedFilterValue,
  savedFromValue,
} from './filterValue'

const FILTERS: ReadonlyArray<{ id: GraphFilter; label: string; hint: string }> = [
  { id: 'recent', label: 'Recent', hint: 'Mutable changes, bookmarks and tags' },
  { id: 'mine', label: 'Mine', hint: 'All your open changes' },
  {
    id: 'myHistory',
    label: 'My history',
    hint: 'Your open changes, and your history in the time range',
  },
  { id: 'stack', label: 'Stack', hint: 'Changes connected to the working copy' },
  { id: 'working', label: 'Working copy', hint: 'The working copy and its last 5 parents' },
  { id: 'jjLog', label: 'jj log', hint: 'The revset jj log shows (revsets.log)' },
]

interface FilterSelectProps {
  graph: GraphState
  savedRevsets: readonly SavedRevset[]
  onCustomRevset: () => void
  onPickSaved: (revset: string) => void
}

function filterHint(graph: GraphState): string | undefined {
  if (graph.revset !== null) {
    return graph.revset
  }
  if (graph.filter === 'jjLog') {
    return graph.logRevset === undefined
      ? 'jj log: revsets.log is empty or unreadable, so this shows the recent changes'
      : `jj log: ${graph.logRevset}`
  }
  return FILTERS.find((f) => f.id === graph.filter)?.hint
}

// The presets, the saved revsets by name, and "Revset…" for typing one.
export function FilterSelect({
  graph,
  savedRevsets,
  onCustomRevset,
  onPickSaved,
}: FilterSelectProps) {
  const onChange = (value: string) => {
    if (value === CUSTOM_FILTER) {
      onCustomRevset()
      return
    }
    if (value === EDIT_SAVED_FILTER) {
      postMessage({ type: 'editSavedRevsets' })
      return
    }
    const saved = savedFromValue(value, savedRevsets)
    if (saved) {
      onPickSaved(saved.revset)
      return
    }
    postMessage({ type: 'setFilter', filter: value as GraphFilter })
  }

  return (
    <select
      className="compact-select"
      value={filterValue(graph, savedRevsets)}
      title={filterHint(graph)}
      aria-label="Filter"
      onChange={(e) => onChange(e.target.value)}
    >
      {FILTERS.map((f) => (
        <option key={f.id} value={f.id} title={f.hint}>
          {f.label}
        </option>
      ))}
      {savedRevsets.length > 0 && (
        <optgroup label="Saved">
          {savedRevsets.map((saved, index) => (
            <option
              key={`${index}\n${saved.label}`}
              value={savedFilterValue(index)}
              title={saved.revset}
            >
              {saved.label}
            </option>
          ))}
          <option value={EDIT_SAVED_FILTER} title="Rename, reorder or remove saved revsets">
            Edit saved revsets…
          </option>
        </optgroup>
      )}
      <option value={CUSTOM_FILTER} title="Show the changes of a revset you type">
        Revset…
      </option>
    </select>
  )
}
