import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { GraphState, WebviewMessage } from '../../../shared/protocol'
import { postMessage } from '../shared/hostApi'
import {
  applyCompletion,
  revsetCompletions,
  sourcesFromCommits,
  type RevsetCandidate,
} from './revsetCompletion'

// The host's answer to the last revset sent. `id` tells two equal answers apart.
export interface RevsetReply {
  id: number
  revset: string
  error: string | null
}

interface RevsetBarProps {
  graph: GraphState
  history: readonly string[]
  reply: RevsetReply | null
  onClose: () => void
}

function send(message: WebviewMessage) {
  postMessage(message)
}

// A revset to show instead of the filter. The host checks it first, so a typo shows its error
// here and keeps the current graph.
export function RevsetBar({ graph, history, reply, onClose }: RevsetBarProps) {
  const [text, setText] = useState(graph.revset ?? '')
  const [cursor, setCursor] = useState(text.length)
  const [error, setError] = useState<string | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [isListOpen, setIsListOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const input = useRef<HTMLInputElement>(null)
  const seen = useRef(reply?.id ?? 0)

  useEffect(() => {
    send({ type: 'listRevsets' })
  }, [graph.repoId])

  useEffect(() => {
    if (!reply || reply.id === seen.current) {
      return
    }
    seen.current = reply.id
    setIsChecking(false)
    setError(reply.error)
    if (reply.error === null && reply.revset === '') {
      onClose()
    }
  }, [reply, onClose])

  const sources = useMemo(() => sourcesFromCommits(graph.commits, history), [graph, history])
  const candidates = useMemo(
    () => (isListOpen ? revsetCompletions(text, cursor, sources) : []),
    [isListOpen, text, cursor, sources],
  )

  const edit = (next: string, at: number) => {
    setText(next)
    setCursor(at)
    setActive(-1)
    setIsListOpen(true)
    setError(null)
  }

  const accept = (candidate: RevsetCandidate) => {
    const next = applyCompletion(text, cursor, candidate)
    edit(next.text, next.cursor)
    requestAnimationFrame(() => input.current?.setSelectionRange(next.cursor, next.cursor))
  }

  const apply = () => {
    setIsListOpen(false)
    if (text.trim() === (graph.revset ?? '') && text.trim() !== '') {
      return
    }
    setIsChecking(true)
    send({ type: 'setRevset', revset: text })
  }

  const clear = () => {
    setText('')
    setError(null)
    if (graph.revset === null) {
      onClose()
      return
    }
    setIsChecking(true)
    send({ type: 'setRevset', revset: '' })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return
    }
    const count = candidates.length
    if (event.key === 'ArrowDown' && count > 0) {
      event.preventDefault()
      setActive((index) => (index + 1) % count)
    } else if (event.key === 'ArrowUp' && count > 0) {
      event.preventDefault()
      setActive((index) => (index <= 0 ? count - 1 : index - 1))
    } else if (event.key === 'Tab' && count > 0) {
      event.preventDefault()
      const candidate = candidates[Math.max(active, 0)]
      if (candidate) {
        accept(candidate)
      }
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const candidate = active >= 0 ? candidates[active] : undefined
      if (candidate) {
        accept(candidate)
      } else {
        apply()
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (count > 0) {
        setIsListOpen(false)
      } else if (graph.revset === null) {
        onClose()
      } else {
        setText(graph.revset)
        setError(null)
      }
    }
  }

  return (
    <div className="revset-bar">
      <div className="revset-field">
        <span className="codicon codicon-filter" aria-hidden />
        <input
          ref={input}
          className="revset-input"
          value={text}
          placeholder='Revset, e.g. mine() & description(substring:"fix")'
          aria-label="Revset"
          aria-invalid={error !== null}
          aria-autocomplete="list"
          aria-expanded={candidates.length > 0}
          spellCheck={false}
          autoFocus={graph.revset === null}
          onChange={(e) => edit(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
          onFocus={() => setIsListOpen(true)}
          onBlur={() => setIsListOpen(false)}
          onKeyDown={onKeyDown}
        />
        {isChecking && (
          <span className="codicon codicon-loading codicon-modifier-spin" aria-label="Checking" />
        )}
        <button
          className="icon-button"
          title="Apply revset (Enter)"
          aria-label="Apply revset"
          onClick={apply}
        >
          <span className="codicon codicon-check" aria-hidden />
        </button>
        <button
          className="icon-button"
          title="Back to the filter"
          aria-label="Clear revset"
          onClick={clear}
        >
          <span className="codicon codicon-close" aria-hidden />
        </button>
      </div>
      {candidates.length > 0 && (
        <ul className="revset-candidates" role="listbox" aria-label="Revset suggestions">
          {candidates.map((candidate, index) => (
            <li
              key={`${candidate.detail}\n${candidate.label}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'is-active' : undefined}
              // Keeps the focus in the input, which closes the list on blur.
              onMouseDown={(e) => {
                e.preventDefault()
                accept(candidate)
              }}
            >
              <span className="revset-candidate-label">{candidate.label}</span>
              <span className="revset-candidate-detail">{candidate.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <pre className="revset-error" role="alert">
          {error}
        </pre>
      )}
    </div>
  )
}
