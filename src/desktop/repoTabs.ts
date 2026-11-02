import type { RepoSummary } from '../../shared/protocol'

const MAX_NAME_LENGTH = 80

// How the user arranged the repository tabs. Kept by repository root in state.json, so every
// window shows a repository with the same name, place and pin.
export interface RepoTabPrefs {
  // The unpinned tabs, front first. Tabs missing here follow, in the registry's order.
  order: string[]
  names: Record<string, string>
  // The pinned tabs, front first. They always come before the others.
  pinned: string[]
}

export const EMPTY_PREFS: RepoTabPrefs = { order: [], names: {}, pinned: [] }

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

// state.json can be edited by hand or come from another version, so nothing in it is trusted.
export function readPrefs(stored: unknown): RepoTabPrefs {
  if (typeof stored !== 'object' || stored === null) {
    return EMPTY_PREFS
  }
  const { order, names, pinned } = stored as Record<string, unknown>
  const named =
    typeof names === 'object' && names !== null
      ? Object.fromEntries(
          Object.entries(names).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : {}
  return { order: strings(order), names: named, pinned: strings(pinned) }
}

// The tabs of a window in the order to show them, with their custom names.
export function arrangeTabs(repos: readonly RepoSummary[], prefs: RepoTabPrefs): RepoSummary[] {
  const byId = new Map(repos.map((repo) => [repo.id, repo]))
  const pinned = prefs.pinned.flatMap((id) => byId.get(id) ?? [])
  const isPinned = new Set(pinned.map((repo) => repo.id))
  const rest = repos.filter((repo) => !isPinned.has(repo.id))
  const placed = prefs.order.flatMap((id) => rest.find((repo) => repo.id === id) ?? [])
  const unplaced = rest.filter((repo) => !prefs.order.includes(repo.id))
  return [...pinned, ...placed, ...unplaced].map((repo) => {
    const name = prefs.names[repo.id]
    return {
      ...repo,
      label: name ?? repo.label,
      folderLabel: repo.label,
      isPinned: isPinned.has(repo.id),
    }
  })
}

// A blank name gives the tab its folder name back.
export function rename(prefs: RepoTabPrefs, root: string, name: string): RepoTabPrefs {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH)
  const others = Object.fromEntries(Object.entries(prefs.names).filter(([id]) => id !== root))
  return { ...prefs, names: trimmed ? { ...others, [root]: trimmed } : others }
}

export function pin(prefs: RepoTabPrefs, root: string): RepoTabPrefs {
  if (prefs.pinned.includes(root)) {
    return prefs
  }
  return {
    ...prefs,
    pinned: [...prefs.pinned, root],
    order: prefs.order.filter((id) => id !== root),
  }
}

// An unpinned tab goes to the front of the others, right next to where it was.
export function unpin(prefs: RepoTabPrefs, root: string): RepoTabPrefs {
  return {
    ...prefs,
    pinned: prefs.pinned.filter((id) => id !== root),
    order: [root, ...prefs.order.filter((id) => id !== root)],
  }
}

// Moves a tab to `toIndex` among the tabs the window shows. A tab stays in its group, so a
// drop past the edge of the pinned tabs stops there. Closed repositories keep their places.
export function move(
  prefs: RepoTabPrefs,
  visible: readonly string[],
  root: string,
  toIndex: number,
): RepoTabPrefs {
  if (!visible.includes(root)) {
    return prefs
  }
  const pinnedCount = visible.filter((id) => prefs.pinned.includes(id)).length
  const isPinned = prefs.pinned.includes(root)
  const [low, high] = isPinned ? [0, pinnedCount - 1] : [pinnedCount, visible.length - 1]
  const index = Math.min(Math.max(Math.trunc(toIndex), low), high)
  const without = visible.filter((id) => id !== root)
  const arranged = [...without.slice(0, index), root, ...without.slice(index)]
  const shownPinned = arranged.slice(0, pinnedCount)
  const shownRest = arranged.slice(pinnedCount)
  return {
    ...prefs,
    pinned: [...shownPinned, ...prefs.pinned.filter((id) => !visible.includes(id))],
    order: [...shownRest, ...prefs.order.filter((id) => !visible.includes(id))],
  }
}
