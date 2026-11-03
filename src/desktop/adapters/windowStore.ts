import type { KeyValueStore } from '../../app/host'

// One window's memory, like its active repository and graph views. What the window changes stays
// with it, so another window does not switch repositories under it. A value the window has not set
// reads from the shared store, which holds what any window saved last and seeds the next start.
export function windowStore(shared: KeyValueStore): KeyValueStore {
  const own = new Map<string, unknown>()
  return {
    get: <T>(key: string) => (own.has(key) ? own.get(key) : shared.get(key)) as T | undefined,
    update: (key, value) => {
      own.set(key, value)
      return shared.update(key, value)
    },
  }
}
