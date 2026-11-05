/** The one row that shows a drop marker. Moving to another row moves the marker. */
export interface DropMarker<K extends string> {
  subscribe(listener: () => void): () => void
  /** The marker kind on this row, or null. */
  kindFor(rowId: string): K | null
  show(rowId: string, kind: K): void
  /** Clears the marker if this row still holds it. */
  hide(rowId: string): void
  clear(): void
}

export function createDropMarker<K extends string>(): DropMarker<K> {
  let current: { rowId: string; kind: K } | null = null
  const listeners = new Set<() => void>()

  const set = (next: { rowId: string; kind: K } | null) => {
    if (current?.rowId === next?.rowId && current?.kind === next?.kind) {
      return
    }
    current = next
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    kindFor(rowId) {
      return current?.rowId === rowId ? current.kind : null
    },
    show(rowId, kind) {
      set({ rowId, kind })
    },
    hide(rowId) {
      if (current?.rowId === rowId) {
        set(null)
      }
    },
    clear() {
      set(null)
    },
  }
}
