import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type {
  DesktopHostMessage,
  DesktopRendererMessage,
  UiAnswer,
  UiPickItem,
  UiRequest,
} from '../../../shared/desktopProtocol'
import { postMessage } from '../shared/hostApi'
import { useHostListener } from '../shared/hooks'

interface Open {
  id: number
  request: UiRequest
  problem?: string
}

type InputRequest = Extract<UiRequest, { kind: 'input' }>
type PickRequest = Extract<UiRequest, { kind: 'pick' }>

const TOAST_MS = 6_000
const ERROR_TOAST_MS = 12_000

function answer(id: number, value: UiAnswer): void {
  postMessage<DesktopRendererMessage>({ type: 'desktop.uiAnswer', id, answer: value })
}

// Renders `$(name)` codicons in labels, as VS Code does in quick picks.
export function Label({ text }: { text: string }) {
  const parts = text.split(/(\$\([a-z0-9-]+\))/g).filter((part) => part.length > 0)
  return (
    <>
      {parts.map((part, index) => {
        const icon = /^\$\(([a-z0-9-]+)\)$/.exec(part)?.[1]
        return icon ? (
          <span key={index} className={`codicon codicon-${icon} label-icon`} aria-hidden />
        ) : (
          <span key={index}>{part}</span>
        )
      })}
    </>
  )
}

function plainText(text: string): string {
  return text.replace(/^Ukemi: /, '')
}

// Shows what the main process asks: notifications, text input, picks and progress.
export function Dialogs() {
  const [open, setOpen] = useState<readonly Open[]>([])

  useHostListener<DesktopHostMessage>((message) => {
    switch (message.type) {
      case 'desktop.ui':
        setOpen((all) => [...all, { id: message.id, request: message.request }])
        return
      case 'desktop.uiClose':
        setOpen((all) => all.filter((item) => item.id !== message.id))
        return
      case 'desktop.uiInvalid':
        setOpen((all) =>
          all.map((item) =>
            item.id === message.id ? { ...item, problem: message.problem } : item,
          ),
        )
        return
      case 'desktop.uiUpdate':
        setOpen((all) =>
          all.map((item) =>
            item.id === message.id && item.request.kind === 'pick'
              ? { ...item, request: { ...item.request, items: message.items } }
              : item,
          ),
        )
        return
    }
  })

  const toasts = open.filter(
    (item) => item.request.kind === 'message' || item.request.kind === 'progress',
  )
  const modal = open.find((item) => item.request.kind === 'input' || item.request.kind === 'pick')

  return (
    <>
      {modal && <ModalPrompt key={modal.id} open={modal} />}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((item) => (
          <Toast key={item.id} open={item} />
        ))}
      </div>
    </>
  )
}

function toastText(request: UiRequest): string {
  if (request.kind === 'message') {
    return plainText(request.text)
  }
  return request.kind === 'progress' ? request.title : ''
}

function Toast({ open }: { open: Open }) {
  const { id, request } = open
  const actions = request.kind === 'message' ? request.actions : []
  const level = request.kind === 'message' ? request.level : 'progress'

  useEffect(() => {
    if (request.kind !== 'message' || actions.length > 0) {
      return
    }
    const timer = setTimeout(
      () => answer(id, { kind: 'cancel' }),
      request.level === 'error' ? ERROR_TOAST_MS : TOAST_MS,
    )
    return () => clearTimeout(timer)
  }, [id, request, actions.length])

  return (
    <div className={`toast toast-${level}`}>
      {level === 'progress' ? (
        <span className="toast-spinner" aria-hidden />
      ) : (
        <span className={`codicon codicon-${level} toast-icon`} aria-hidden />
      )}
      <div className="toast-body">
        <p className="toast-text">{toastText(request)}</p>
        {actions.length > 0 && (
          <div className="toast-actions">
            {actions.map((action, index) => (
              <button
                key={action}
                className={index === 0 ? 'button-primary' : 'button-quiet'}
                onClick={() => answer(id, { kind: 'action', action })}
              >
                {action}
              </button>
            ))}
          </div>
        )}
      </div>
      {request.kind === 'message' && (
        <button
          className="icon-button toast-close"
          aria-label="Dismiss"
          onClick={() => answer(id, { kind: 'cancel' })}
        >
          <span className="codicon codicon-close" aria-hidden />
        </button>
      )}
    </div>
  )
}

function ModalPrompt({ open }: { open: Open }) {
  const cancel = () => answer(open.id, { kind: 'cancel' })
  const { request } = open
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div className="prompt" role="dialog" aria-modal="true">
        {request.kind === 'input' && (
          <InputPrompt id={open.id} request={request} problem={open.problem} />
        )}
        {request.kind === 'pick' && (
          <PickPrompt id={open.id} request={request} problem={open.problem} />
        )}
      </div>
    </div>
  )
}

function PromptHeading({ title, prompt }: { title?: string; prompt?: string }) {
  if (!title && !prompt) {
    return null
  }
  return (
    <header className="prompt-heading">
      {title && <h2>{title}</h2>}
      {prompt && <p>{prompt}</p>}
    </header>
  )
}

function InputPrompt({
  id,
  request,
  problem,
}: {
  id: number
  request: InputRequest
  problem?: string
}) {
  const [value, setValue] = useState(request.value ?? '')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.select()
  }, [])
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      answer(id, { kind: 'text', value })
    } else if (event.key === 'Escape') {
      answer(id, { kind: 'cancel' })
    }
  }
  return (
    <>
      <PromptHeading title={request.title} prompt={request.prompt} />
      <input
        ref={input}
        className={`prompt-input${problem ? ' has-problem' : ''}`}
        type={request.password ? 'password' : 'text'}
        value={value}
        placeholder={request.placeholder}
        autoFocus
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKey}
      />
      {problem && <p className="prompt-problem">{problem}</p>}
      <footer className="prompt-footer">
        <span className="prompt-hint">
          <kbd>Enter</kbd> to confirm · <kbd>Esc</kbd> to cancel
        </span>
      </footer>
    </>
  )
}

function matches(item: UiPickItem, query: string, request: PickRequest): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return true
  }
  const haystack = [
    item.label,
    request.matchOnDescription ? item.description : '',
    request.matchOnDetail ? item.detail : '',
  ]
    .join(' ')
    .toLowerCase()
  return needle.split(/\s+/).every((word) => haystack.includes(word))
}

function PickHint({ request, checked }: { request: PickRequest; checked: number }) {
  if (request.many) {
    return (
      <>
        <kbd>Space</kbd> to check · <kbd>Enter</kbd> to confirm{checked > 0 && ` (${checked})`}
      </>
    )
  }
  if (request.typed) {
    return (
      <>
        <kbd>Enter</kbd> to pick · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to use the typed text
      </>
    )
  }
  return (
    <>
      <kbd>↑</kbd>
      <kbd>↓</kbd> to move · <kbd>Enter</kbd> to pick
    </>
  )
}

function PickPrompt({
  id,
  request,
  problem,
}: {
  id: number
  request: PickRequest
  problem?: string
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set())
  const list = useRef<HTMLUListElement>(null)
  const visible = useMemo(
    () =>
      request.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => matches(item, query, request)),
    [request, query],
  )

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const toggle = (index: number) =>
    setChecked((all) => {
      const next = new Set(all)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })

  const accept = (index?: number) => {
    if (request.many) {
      answer(id, { kind: 'items', indexes: [...checked].sort((a, b) => a - b) })
      return
    }
    const chosen = index ?? visible[active]?.index
    if (chosen !== undefined) {
      answer(id, { kind: 'item', index: chosen })
    } else if (request.typed && query.trim()) {
      answer(id, { kind: 'text', value: query })
    }
  }

  const onKey = (event: KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActive((i) => Math.min(i + 1, visible.length - 1))
        return
      case 'ArrowUp':
        event.preventDefault()
        setActive((i) => Math.max(i - 1, 0))
        return
      case 'Enter':
        event.preventDefault()
        if (request.typed && (event.metaKey || event.ctrlKey) && query.trim()) {
          answer(id, { kind: 'text', value: query })
          return
        }
        accept()
        return
      case ' ': {
        const current = visible[active]
        if (request.many && current) {
          event.preventDefault()
          toggle(current.index)
        }
        return
      }
      case 'Escape':
        answer(id, { kind: 'cancel' })
        return
    }
  }

  return (
    <>
      <PromptHeading title={request.title} />
      <input
        className={`prompt-input${problem ? ' has-problem' : ''}`}
        value={query}
        placeholder={request.placeholder ?? (request.typed ? 'Pick or type…' : 'Filter…')}
        autoFocus
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
      />
      {problem && <p className="prompt-problem">{problem}</p>}
      <ul className="pick-list" ref={list} role="listbox" aria-multiselectable={request.many}>
        {visible.map(({ item, index }, position) => (
          <li
            key={index}
            role="option"
            aria-selected={position === active}
            data-active={position === active}
            className="pick-item"
            onMouseEnter={() => setActive(position)}
            onClick={() => (request.many ? toggle(index) : accept(index))}
          >
            {request.many && (
              <span
                className={`codicon ${checked.has(index) ? 'codicon-pass-filled' : 'codicon-circle-large'} pick-check`}
                aria-hidden
              />
            )}
            <span className="pick-label">
              <Label text={item.label} />
            </span>
            {item.description && <span className="pick-description">{item.description}</span>}
            {item.detail && <span className="pick-detail">{item.detail}</span>}
          </li>
        ))}
        {visible.length === 0 && (
          <li className="pick-empty">
            {request.typed && query.trim() ? (
              <>
                Press <kbd>Enter</kbd> to use <code>{query.trim()}</code>
              </>
            ) : (
              'No matches'
            )}
          </li>
        )}
      </ul>
      <footer className="prompt-footer">
        <span className="prompt-hint">
          <PickHint request={request} checked={checked.size} />
        </span>
      </footer>
    </>
  )
}
