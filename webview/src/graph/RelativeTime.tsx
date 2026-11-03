import { useSyncExternalStore } from 'react'
import { relativeTime } from '../shared/format'

const TICK_MS = 60_000
const listeners = new Set<() => void>()
let now = Date.now()
let timer: number | null = null

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  timer ??= window.setInterval(() => {
    now = Date.now()
    listeners.forEach((notify) => notify())
  }, TICK_MS)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer)
      timer = null
    }
  }
}

// One clock for every row, so the minute tick renders the times and not the whole graph.
export function RelativeTime({ timestamp }: { timestamp: string }) {
  const current = useSyncExternalStore(subscribe, () => now)
  return <>{relativeTime(timestamp, current)}</>
}
