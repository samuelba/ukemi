import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useHostChannel } from './hostChannel'

// Listens for host messages, then posts `ready` so the host only sends once someone is listening.
// The latest handler always runs, so it can read current state without resubscribing.
export function useHostMessages<T>(onMessage: (message: T) => void, ready: unknown): void {
  const handler = useRef(onMessage)
  useLayoutEffect(() => {
    handler.current = onMessage
  })
  const readyMessage = useRef(ready)
  const channel = useHostChannel()
  useEffect(() => {
    const unsubscribe = channel.subscribe((message) => handler.current(message as T))
    channel.post(readyMessage.current)
    return unsubscribe
  }, [channel])
}

// Listens for host messages without posting `ready`, for a view next to the one that does.
export function useHostListener<T>(onMessage: (message: T) => void): void {
  const handler = useRef(onMessage)
  useLayoutEffect(() => {
    handler.current = onMessage
  })
  useEffect(() => {
    const listener = (event: MessageEvent<T>) => handler.current(event.data)
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [])
}

// Tracks an element's height, for a sticky header that later content must clear.
export function useElementHeight(): [ref: (node: HTMLElement | null) => void, height: number] {
  const [height, setHeight] = useState(0)
  const ref = useCallback((node: HTMLElement | null) => {
    if (!node) {
      return
    }
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, height]
}
