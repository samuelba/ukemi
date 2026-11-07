import { useEffect, useRef } from 'react'

interface DropPreviewBarProps {
  text: string
  // False when the drop cannot run. The bar then explains why and only offers Cancel.
  canApply: boolean
  isApplying: boolean
  // Lines it up with the row text, past the graph lanes.
  indent: number
  onApply: () => void
  onCancel: () => void
}

// Fields, buttons and dialogs elsewhere handle their own Enter and Escape.
const HANDLES_KEYS = 'input, textarea, select, button, [contenteditable], .dialog, [role="dialog"]'

function belongsElsewhere(event: KeyboardEvent, bar: HTMLElement | null): boolean {
  if (event.defaultPrevented) {
    return true
  }
  const target = event.target
  if (!(target instanceof Element)) {
    return false
  }
  // Enter on a focused button clicks it, so the bar must not apply a second time.
  if (target instanceof HTMLButtonElement) {
    return event.key === 'Enter'
  }
  return !bar?.contains(target) && target.closest(HANDLES_KEYS) !== null
}

// Sits right under the dropped change. Enter applies and Escape cancels, unless something else
// has the keyboard.
export function DropPreviewBar(props: DropPreviewBarProps) {
  const { canApply, isApplying } = props
  const ref = useRef<HTMLDivElement>(null)
  const handlers = useRef(props)
  handlers.current = props

  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' })
    const button = canApply ? '.drop-preview-apply' : '.drop-preview-cancel'
    ref.current?.querySelector<HTMLButtonElement>(button)?.focus()
  }, [canApply])

  // The buttons go away while jj runs. Focus stays in the bar instead of falling to the page.
  useEffect(() => {
    if (isApplying) {
      ref.current?.focus()
    }
  }, [isApplying])

  useEffect(() => {
    if (isApplying) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const isKey = event.key === 'Escape' || (event.key === 'Enter' && canApply)
      if (!isKey || belongsElsewhere(event, ref.current)) {
        return
      }
      event.preventDefault()
      if (event.key === 'Escape') {
        handlers.current.onCancel()
      } else {
        handlers.current.onApply()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isApplying, canApply])

  return (
    <div role="none">
      <div
        ref={ref}
        className={`drop-preview${canApply ? '' : ' is-error'}`}
        role="group"
        aria-label="Drop preview"
        tabIndex={-1}
        style={{ marginLeft: props.indent }}
      >
        <i className={`codicon codicon-${canApply ? 'git-pull-request-draft' : 'warning'}`} />
        <span className="drop-preview-text" role="status">
          {isApplying ? `${props.text}…` : props.text}
        </span>
        {!isApplying && (
          <span className="drop-preview-actions">
            <button
              className="button secondary drop-preview-cancel"
              onClick={props.onCancel}
              title="Cancel (Escape)"
            >
              Cancel
            </button>
            {canApply && (
              <button
                className="button drop-preview-apply"
                onClick={props.onApply}
                title="Apply (Enter)"
              >
                Apply
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  )
}
