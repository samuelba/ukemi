import { useEffect, useRef } from 'react'
import type { WebviewMessage } from '../../../shared/protocol'
import { postMessage } from '../shared/hostApi'

interface LoadMoreRowProps {
  // The number of commits shown.
  shown: number
}

function loadMore(): void {
  postMessage({ type: 'loadMore' } satisfies WebviewMessage)
}

// The end of a truncated graph. Scrolling it into view loads the next page. It asks once per
// count, so a load that fails or brings nothing new does not repeat while the row stays in view.
// The button is there for the keyboard, and in case the observer never fires.
export function LoadMoreRow({ shown }: LoadMoreRowProps) {
  const row = useRef<HTMLDivElement>(null)
  const requestedAt = useRef<number | null>(null)

  useEffect(() => {
    const element = row.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && requestedAt.current !== shown) {
          requestedAt.current = shown
          loadMore()
        }
      },
      { rootMargin: '0px 0px 300px 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [shown])

  return (
    <div ref={row} className="load-more" role="none">
      <span>Showing the newest {shown} changes.</span>
      <button className="link-button" onClick={loadMore}>
        Load more
      </button>
    </div>
  )
}
