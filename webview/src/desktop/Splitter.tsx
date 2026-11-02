import { useRef, type PointerEvent } from 'react'

// A drag handle between two panes. `onDrag` gets the pointer movement since the last call.
export function Splitter({
  label,
  direction,
  onDrag,
  onReset,
}: {
  label: string
  direction: 'columns' | 'rows'
  onDrag: (delta: number) => void
  onReset?: () => void
}) {
  const start = useRef<number | null>(null)
  const position = (event: PointerEvent) =>
    direction === 'columns' ? event.clientX : event.clientY
  return (
    <div
      className={`splitter splitter-${direction}`}
      role="separator"
      aria-orientation={direction === 'columns' ? 'vertical' : 'horizontal'}
      aria-label={label}
      title={onReset ? 'Drag to resize, double-click to reset' : undefined}
      onPointerDown={(event) => {
        start.current = position(event)
        ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (start.current === null) {
          return
        }
        onDrag(position(event) - start.current)
        start.current = position(event)
      }}
      onPointerUp={() => (start.current = null)}
      onDoubleClick={onReset}
    />
  )
}
