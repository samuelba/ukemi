import { useSyncExternalStore } from 'react'

export interface DiffOptions {
  layout: 'unified' | 'split'
  ignoreWhitespace: boolean
  // Every line of a file, not only its changes.
  fullFile: boolean
}

const OPTIONS_KEY = 'ukemi.diff.options'
const DEFAULT_OPTIONS: DiffOptions = {
  layout: 'unified',
  ignoreWhitespace: false,
  fullFile: false,
}

function readOptions(): DiffOptions {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}')
    const value = typeof saved === 'object' && saved !== null ? (saved as Partial<DiffOptions>) : {}
    return {
      layout: value.layout === 'split' ? 'split' : 'unified',
      ignoreWhitespace: value.ignoreWhitespace === true,
      fullFile: value.fullFile === true,
    }
  } catch {
    return DEFAULT_OPTIONS
  }
}

// One choice for every diff in the window, so the history tab and the change pane agree.
let current = readOptions()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setDiffOptions(change: Partial<DiffOptions>): void {
  current = { ...current, ...change }
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(current))
  } catch {
    // The choice still holds until the window closes.
  }
  listeners.forEach((listener) => listener())
}

export function useDiffOptions(): DiffOptions {
  return useSyncExternalStore(subscribe, () => current)
}

function Toggle({
  title,
  icon,
  isOn,
  onClick,
}: {
  title: string
  icon: string
  isOn: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`icon-button${isOn ? ' is-on' : ''}`}
      title={title}
      aria-pressed={isOn}
      onClick={onClick}
    >
      <span className={`codicon codicon-${icon}`} aria-hidden />
    </button>
  )
}

// The layout, whitespace and whole-file toggles, for a diff's toolbar. A patch from jj is
// already diffed and has no sides to read, so it has only the layout toggle.
export function DiffOptionButtons({ hasSides = true }: { hasSides?: boolean }) {
  const options = useDiffOptions()
  const isSplit = options.layout === 'split'
  return (
    <>
      <Toggle
        title="Side by side"
        icon="split-horizontal"
        isOn={isSplit}
        onClick={() => setDiffOptions({ layout: isSplit ? 'unified' : 'split' })}
      />
      {hasSides && (
        <>
          <Toggle
            title="Ignore whitespace"
            icon="whitespace"
            isOn={options.ignoreWhitespace}
            onClick={() => setDiffOptions({ ignoreWhitespace: !options.ignoreWhitespace })}
          />
          <Toggle
            title="Show the whole file"
            icon="unfold"
            isOn={options.fullFile}
            onClick={() => setDiffOptions({ fullFile: !options.fullFile })}
          />
        </>
      )}
    </>
  )
}
