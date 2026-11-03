import type { KeyboardEvent } from 'react'

interface GraphSearchProps {
  text: string
  matchCount: number | null
  position: number | null
  onChange: (text: string) => void
  onStep: (direction: 1 | -1) => void
  onClose: () => void
}

function countLabel(matchCount: number | null, position: number | null): string {
  if (matchCount === null) {
    return ''
  }
  if (matchCount === 0) {
    return 'No matches'
  }
  return position === null ? `${matchCount}` : `${position} of ${matchCount}`
}

// Searches the loaded changes. Other rows fade, so the graph keeps its shape.
export function GraphSearch({
  text,
  matchCount,
  position,
  onChange,
  onStep,
  onClose,
}: GraphSearchProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      onStep(event.shiftKey ? -1 : 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }
  const hasMatches = (matchCount ?? 0) > 0
  return (
    <div className="graph-search" role="search">
      <span className="codicon codicon-search" aria-hidden />
      <input
        className="graph-search-input"
        value={text}
        placeholder="Search descriptions, authors, bookmarks (author:name)"
        aria-label="Search changes"
        spellCheck={false}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className="graph-search-count" aria-live="polite">
        {countLabel(matchCount, position)}
      </span>
      <button
        className="icon-button"
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
        disabled={!hasMatches}
        onClick={() => onStep(-1)}
      >
        <span className="codicon codicon-arrow-up" aria-hidden />
      </button>
      <button
        className="icon-button"
        title="Next match (Enter)"
        aria-label="Next match"
        disabled={!hasMatches}
        onClick={() => onStep(1)}
      >
        <span className="codicon codicon-arrow-down" aria-hidden />
      </button>
      <button
        className="icon-button"
        title="Close search (Escape)"
        aria-label="Close search"
        onClick={onClose}
      >
        <span className="codicon codicon-close" aria-hidden />
      </button>
    </div>
  )
}
