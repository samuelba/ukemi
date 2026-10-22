import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

interface DescribeDialogProps {
  heading: string
  initial: string
  canStartNew: boolean
  onSave: (message: string, startNew: boolean) => void
  onCancel: () => void
}

export function DescribeDialog({
  heading,
  initial,
  canStartNew,
  onSave,
  onCancel,
}: DescribeDialogProps) {
  const [message, setMessage] = useState(initial)
  const textarea = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textarea.current?.focus()
    textarea.current?.select()
  }, [])

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onCancel()
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      onSave(message, canStartNew && event.shiftKey)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-label={heading}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-title">{heading}</div>
        <textarea
          ref={textarea}
          value={message}
          rows={6}
          placeholder="Title on the first line, details below"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="dialog-hint">
          Ctrl+Enter to save{canStartNew ? ', Ctrl+Shift+Enter to save and start a new change' : ''}
        </div>
        <div className="dialog-buttons">
          <button className="button secondary" onClick={onCancel}>
            Cancel
          </button>
          {canStartNew && (
            <button className="button secondary" onClick={() => onSave(message, true)}>
              Save and new
            </button>
          )}
          <button className="button" onClick={() => onSave(message, false)}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
