import type { SavedRevset } from './model'

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// The `savedRevsets` setting maps labels to revsets. settings.json is edited by hand, so entries
// that are not two non-empty strings are dropped. The map's order is the dropdown's order.
export function savedRevsetList(value: unknown): SavedRevset[] {
  if (!isMap(value)) {
    return []
  }
  const saved: SavedRevset[] = []
  for (const [key, revset] of Object.entries(value)) {
    const label = key.trim()
    // Two keys can differ only in outer whitespace. The first one wins, as in a lookup.
    if (typeof revset !== 'string' || label === '' || revset.trim() === '') {
      continue
    }
    if (!saved.some((entry) => entry.label === label)) {
      saved.push({ label, revset: revset.trim() })
    }
  }
  return saved
}

export function findSavedRevset(
  saved: readonly SavedRevset[],
  revset: string,
): SavedRevset | undefined {
  const text = revset.trim()
  return saved.find((entry) => entry.revset === text)
}

export function savedRevsetByLabel(
  saved: readonly SavedRevset[],
  label: string,
): SavedRevset | undefined {
  return label === '' ? undefined : saved.find((entry) => entry.label === label)
}

// The setting's new value with `label` saved. An existing label keeps its place in the map, and
// hand-written keys that are the label with outer whitespace give way to it.
export function withSavedRevset(
  current: unknown,
  label: string,
  revset: string,
): Record<string, string> {
  const entries = isMap(current)
    ? Object.entries(current).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      )
    : []
  const at = entries.findIndex(([key]) => key.trim() === label)
  const others = entries.filter(([key]) => key.trim() !== label)
  const next: Array<[string, string]> =
    at === -1
      ? [...others, [label, revset]]
      : [...others.slice(0, at), [label, revset], ...others.slice(at)]
  return Object.fromEntries(next)
}
