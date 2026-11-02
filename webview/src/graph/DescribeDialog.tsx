import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { SuggesterView } from '../../../shared/protocol'
import { postMessage } from '../shared/hostApi'

// The host's answer to a suggestion request.
export interface SuggestionReply {
  requestId: string
  text?: string
  error?: string
}

interface DescribeDialogProps {
  heading: string
  commitId: string
  initial: string
  canStartNew: boolean
  suggesters: readonly SuggesterView[]
  suggestionReply: SuggestionReply | null
  onSave: (message: string, startNew: boolean) => void
  onCancel: () => void
}

interface PendingSuggestion {
  requestId: string
  label: string
}

let nextRequest = 0

export function DescribeDialog({
  heading,
  commitId,
  initial,
  canStartNew,
  suggesters,
  suggestionReply,
  onSave,
  onCancel,
}: DescribeDialogProps) {
  const [message, setMessage] = useState(initial)
  const [pending, setPending] = useState<PendingSuggestion | null>(null)
  const [beforeSuggestion, setBeforeSuggestion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const pendingId = useRef<string | null>(null)

  useEffect(() => {
    textarea.current?.focus()
    textarea.current?.select()
  }, [])

  useEffect(() => {
    pendingId.current = pending?.requestId ?? null
  }, [pending])

  // A request still running when the dialog closes is of no use any more.
  useEffect(
    () => () => {
      if (pendingId.current) {
        postMessage({ type: 'cancelSuggestion', requestId: pendingId.current })
      }
    },
    [],
  )

  useEffect(() => {
    if (!suggestionReply || suggestionReply.requestId !== pendingId.current) {
      return
    }
    setPending(null)
    if (suggestionReply.text !== undefined) {
      setBeforeSuggestion(message)
      setMessage(suggestionReply.text)
      textarea.current?.focus()
    } else {
      setError(suggestionReply.error ?? 'No suggestion.')
    }
    // Only a new reply matters, not edits to the message meanwhile.
  }, [suggestionReply])

  const suggest = (suggester: SuggesterView) => {
    const requestId = `suggest-${++nextRequest}`
    setError(null)
    setPending({ requestId, label: suggester.label })
    postMessage({ type: 'suggestDescription', requestId, commitId, suggester: suggester.id })
  }

  const stop = () => {
    if (pending) {
      postMessage({ type: 'cancelSuggestion', requestId: pending.requestId })
      setPending(null)
    }
  }

  const undoSuggestion = () => {
    if (beforeSuggestion !== null) {
      setMessage(beforeSuggestion)
      setBeforeSuggestion(null)
    }
  }

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
          readOnly={pending !== null}
          aria-busy={pending !== null}
          onChange={(e) => {
            setMessage(e.target.value)
            setBeforeSuggestion(null)
          }}
          onKeyDown={onKeyDown}
        />
        {pending && (
          <div className="dialog-hint suggest-status" role="status">
            <i className="codicon codicon-loading codicon-modifier-spin" />
            Asking {pending.label}…
            <button className="link-button" onClick={stop}>
              Stop
            </button>
          </div>
        )}
        {!pending && beforeSuggestion !== null && (
          <div className="dialog-hint suggest-status">
            Suggested description.
            <button className="link-button" onClick={undoSuggestion}>
              Undo
            </button>
          </div>
        )}
        {error && (
          <div className="dialog-error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-hint">
          Ctrl+Enter to save{canStartNew ? ', Ctrl+Shift+Enter to save and start a new change' : ''}
        </div>
        {suggesters.length > 0 && (
          <div className="suggest-buttons">
            {suggesters.map((suggester) => (
              <button
                key={suggester.id}
                className="button secondary"
                disabled={pending !== null}
                title={`Suggest a description with ${suggester.label}. Sends the change's diff to it.`}
                onClick={() => suggest(suggester)}
              >
                <i className="codicon codicon-sparkle" />
                {suggester.label}
              </button>
            ))}
            <div className="dialog-hint suggest-note">
              Uses your own AI tools and their accounts. The change&apos;s diff is sent to them.
            </div>
          </div>
        )}
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
