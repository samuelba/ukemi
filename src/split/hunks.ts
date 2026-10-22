import { diffLines } from 'diff'
import type { Segment } from '../../shared/split'

export function computeSegments(left: string, right: string): Segment[] {
  const segments: Segment[] = []
  let pending: { removed: string; added: string } | null = null
  let nextId = 0

  const flush = () => {
    if (pending) {
      segments.push({ kind: 'change', id: nextId++, ...pending })
      pending = null
    }
  }

  for (const part of diffLines(left, right)) {
    if (!part.added && !part.removed) {
      flush()
      segments.push({ kind: 'same', text: part.value })
      continue
    }
    pending ??= { removed: '', added: '' }
    if (part.added) {
      pending.added += part.value
    } else {
      pending.removed += part.value
    }
  }
  flush()
  return segments
}

export function buildContent(segments: readonly Segment[], selected: ReadonlySet<number>): string {
  return segments
    .map((s) => {
      if (s.kind === 'same') {
        return s.text
      }
      return selected.has(s.id) ? s.added : s.removed
    })
    .join('')
}
