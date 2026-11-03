import { relative, sep } from 'node:path'

// How many repositories File > Open Recent lists.
export const MAX_RECENT = 10

// state.json can be edited by hand or come from another version, so nothing in it is trusted.
export function readRecent(stored: unknown): string[] {
  if (!Array.isArray(stored)) {
    return []
  }
  const roots = stored.filter((item): item is string => typeof item === 'string' && item !== '')
  return [...new Set(roots)].slice(0, MAX_RECENT)
}

// The list after a repository was used: it moves to the front, and the oldest falls off.
export function remember(recent: readonly string[], root: string): string[] {
  return [root, ...recent.filter((item) => item !== root)].slice(0, MAX_RECENT)
}

export function forget(recent: readonly string[], root: string): string[] {
  return recent.filter((item) => item !== root)
}

// The menu label of a repository: its path, with the home folder as `~`.
export function recentLabel(root: string, home: string): string {
  const inside = relative(home, root)
  const isInHome = home !== '' && inside !== '' && !inside.startsWith('..') && inside !== root
  return isInHome ? `~${sep}${inside}` : root
}
