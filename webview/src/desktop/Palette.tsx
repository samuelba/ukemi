import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { DesktopRendererMessage, PaletteCommand } from '../../../shared/desktopProtocol'
import { postMessage } from '../shared/hostApi'
import { useModalFocus } from '../shared/useModalFocus'

const RECENT_KEY = 'ukemi.palette.recent'
const RECENT_LIMIT = 5

function readRecent(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function remember(command: string): void {
  try {
    const next = [command, ...readRecent().filter((c) => c !== command)].slice(0, RECENT_LIMIT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Recent commands are a convenience only.
  }
}

// Scores a title against the query: every word must appear, earlier and whole-word hits rank first.
export function scoreCommand(title: string, query: string): number {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const haystack = title.toLowerCase()
  let score = 0
  for (const word of words) {
    const at = haystack.indexOf(word)
    if (at < 0) {
      return -1
    }
    score += at === 0 || haystack[at - 1] === ' ' ? 10 : 1
    score -= at / 100
  }
  return score
}

export function Palette({
  commands,
  onClose,
}: {
  commands: readonly PaletteCommand[]
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const trapFocus = useModalFocus(dialog, { onEscape: onClose })
  const listId = useId()
  const recent = useMemo(readRecent, [])

  const visible = useMemo(() => {
    if (!query.trim()) {
      const byId = new Map(commands.map((c) => [c.command, c]))
      const first = recent.flatMap((id) => byId.get(id) ?? [])
      const rest = commands
        .filter((c) => !recent.includes(c.command))
        .sort((a, b) => a.title.localeCompare(b.title))
      return [...first, ...rest]
    }
    return commands
      .map((command) => ({ command, score: scoreCommand(command.title, query) }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title))
      .map((item) => item.command)
  }, [commands, query, recent])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (command: PaletteCommand | undefined) => {
    if (!command) {
      return
    }
    remember(command.command)
    onClose()
    postMessage<DesktopRendererMessage>({ type: 'desktop.run', command: command.command })
  }

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => Math.min(i + 1, visible.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      run(visible[active])
    } else if (event.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="prompt palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        <input
          className="prompt-input"
          role="combobox"
          aria-label="Command"
          aria-controls={listId}
          aria-expanded="true"
          aria-autocomplete="list"
          aria-activedescendant={visible[active] ? `${listId}-${active}` : undefined}
          value={query}
          placeholder="Run a command…"
          autoFocus
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
        <ul className="pick-list" ref={list} id={listId} role="listbox" aria-label="Commands">
          {visible.map((command, position) => (
            <li
              key={command.command}
              id={`${listId}-${position}`}
              role="option"
              aria-selected={position === active}
              data-active={position === active}
              className="pick-item"
              onMouseEnter={() => setActive(position)}
              onClick={() => run(command)}
            >
              <span className="pick-label">{command.title}</span>
              {!query.trim() && recent.includes(command.command) && (
                <span className="pick-description">recently used</span>
              )}
            </li>
          ))}
          {visible.length === 0 && <li className="pick-empty">No commands match</li>}
        </ul>
      </div>
    </div>
  )
}
