import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { DiffDocument } from '../../../shared/desktopProtocol'
import type {
  BlameRun,
  FileBlame,
  FileHistoryEntry,
  FileHistoryHostMessage,
  FileHistoryWebviewMessage,
} from '../../../shared/fileHistory'
import { DiffView } from '../desktop/DiffView'
import { Splitter } from '../desktop/Splitter'
import { RelativeTime } from '../graph/RelativeTime'
import { useHostMessages } from '../shared/hooks'
import { useSend } from '../shared/hostChannel'

const LIST_KEY = 'ukemi.history.listShare'
const DEFAULT_LIST_SHARE = 0.4
const MIN_SHARE = 0.1
const MAX_SHARE = 0.85

type Mode = 'changes' | 'blame'
type Send = (message: FileHistoryWebviewMessage) => void

// The diff of the file in one change. Answers to an earlier selection are told apart by commit.
type Diff = { commitId: string; document: DiffDocument } | { commitId: string; error: string }

interface BlameRow {
  line: number
  text: string
  // Set on the first line of a run, which carries the label.
  run: BlameRun | null
  isRunEnd: boolean
}

function readShare(): number {
  const saved = Number(localStorage.getItem(LIST_KEY))
  return saved >= MIN_SHARE && saved <= MAX_SHARE ? saved : DEFAULT_LIST_SHARE
}

function blameRows(blame: FileBlame): BlameRow[] {
  const lines = blame.text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  const starts = new Map(blame.runs.map((run) => [run.start, run]))
  const ends = new Set(blame.runs.map((run) => run.start + run.count - 1))
  return lines.map((text, index) => ({
    line: index + 1,
    text,
    run: starts.get(index + 1) ?? null,
    isRunEnd: ends.has(index + 1),
  }))
}

// The history tab of one file: the changes that touched it with the file's diff in the selected
// one, and who last changed each line.
export function HistoryApp() {
  const send = useSend<FileHistoryWebviewMessage>()
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<FileHistoryEntry[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<Diff | null>(null)
  const [blame, setBlame] = useState<FileBlame | null>(null)
  const [mode, setMode] = useState<Mode>('changes')
  const [error, setError] = useState<string | null>(null)
  const [isLoadingBlame, setIsLoadingBlame] = useState(false)
  const [share, setShare] = useState(readShare)
  const split = useRef<HTMLDivElement>(null)

  // The list's share of the height, so the diff below can be given more or less room.
  const resize = (delta: number) => {
    const height = split.current?.clientHeight ?? 1
    setShare((current) => {
      const next = Math.min(MAX_SHARE, Math.max(MIN_SHARE, current + delta / height))
      localStorage.setItem(LIST_KEY, String(next))
      return next
    })
  }

  const select = (commitId: string) => {
    setSelected(commitId)
    setMode('changes')
    send({ type: 'select', commitId })
  }

  useHostMessages<FileHistoryHostMessage>(
    (message) => {
      switch (message.type) {
        case 'load': {
          setPath(message.path)
          setEntries(message.entries)
          setError(null)
          // The newest change is shown first, so the tab opens with a diff and not a blank half.
          const kept = message.entries.some((entry) => entry.commitId === selected)
          const first = message.entries[0]
          if (kept && selected) {
            send({ type: 'select', commitId: selected })
          } else if (first) {
            setSelected(first.commitId)
            send({ type: 'select', commitId: first.commitId })
          }
          return
        }
        case 'diff':
          setDiff({ commitId: message.commitId, document: message.document })
          return
        case 'diffError':
          setDiff({ commitId: message.commitId, error: message.message })
          return
        case 'blame':
          setBlame(message.blame)
          setIsLoadingBlame(false)
          setError(null)
          return
        case 'error':
          setIsLoadingBlame(false)
          setError(message.message)
          return
      }
    },
    { type: 'ready' } satisfies FileHistoryWebviewMessage,
  )

  const showBlame = () => {
    setMode('blame')
    if (!blame && !isLoadingBlame) {
      setIsLoadingBlame(true)
      send({ type: 'loadBlame' })
    }
  }

  const refresh = () => {
    send({ type: 'ready' })
    if (mode === 'blame') {
      setIsLoadingBlame(true)
      send({ type: 'loadBlame' })
    } else {
      setBlame(null)
    }
  }

  const rows = useMemo(() => (blame ? blameRows(blame) : []), [blame])
  const entry = entries?.find((e) => e.commitId === selected) ?? null
  const blamedEntry = selected && blame ? blame.changes[selected] : undefined
  const shown = entry ?? blamedEntry ?? null

  return (
    <div className="history">
      <header className="history-header">
        <h1 className="history-path" title={path}>
          {path || 'Loading…'}
        </h1>
        <div className="history-modes" role="tablist" aria-label="View">
          <button
            role="tab"
            aria-selected={mode === 'changes'}
            className={mode === 'changes' ? 'is-active' : undefined}
            onClick={() => setMode('changes')}
          >
            Changes{entries ? ` (${entries.length})` : ''}
          </button>
          <button
            role="tab"
            aria-selected={mode === 'blame'}
            className={mode === 'blame' ? 'is-active' : undefined}
            onClick={showBlame}
          >
            Blame
          </button>
        </div>
        <button className="icon-button" title="Refresh" aria-label="Refresh" onClick={refresh}>
          <span className="codicon codicon-refresh" aria-hidden />
        </button>
      </header>
      {error && (
        <div className="error-box" role="alert">
          <span className="codicon codicon-error" aria-hidden />
          <span className="error-text">{error}</span>
        </div>
      )}
      {mode === 'changes' ? (
        <div
          ref={split}
          className="history-split"
          style={{
            gridTemplateRows: shown
              ? `minmax(0, ${share}fr) 1px minmax(0, ${1 - share}fr)`
              : 'minmax(0, 1fr)',
          }}
        >
          <ChangeList entries={entries} selected={selected} onSelect={select} />
          {shown && (
            <Splitter
              label="Resize the history list"
              direction="rows"
              onDrag={resize}
              onReset={() => {
                localStorage.removeItem(LIST_KEY)
                setShare(DEFAULT_LIST_SHARE)
              }}
            />
          )}
          {shown && (
            <ChangeDetail
              entry={shown}
              diff={diff?.commitId === shown.commitId ? diff : null}
              send={send}
            />
          )}
        </div>
      ) : isLoadingBlame || !blame ? (
        <p className="history-empty">Loading blame…</p>
      ) : (
        <BlameView blame={blame} rows={rows} onSelect={select} />
      )}
    </div>
  )
}

function ChangeList({
  entries,
  selected,
  onSelect,
}: {
  entries: FileHistoryEntry[] | null
  selected: string | null
  onSelect: (commitId: string) => void
}) {
  const list = useRef<HTMLUListElement>(null)

  // Keeps the selection in view while the arrow keys step through the history.
  useEffect(() => {
    if (selected) {
      list.current
        ?.querySelector(`[data-commit-id="${CSS.escape(selected)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }
  }, [selected])

  if (entries === null) {
    return <p className="history-empty">Loading history…</p>
  }
  if (entries.length === 0) {
    return <p className="history-empty">No change touched this file.</p>
  }

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step === 0) {
      return
    }
    event.preventDefault()
    const index = entries.findIndex((entry) => entry.commitId === selected)
    const next = entries[Math.min(entries.length - 1, Math.max(0, index + step))]
    if (next && next.commitId !== selected) {
      onSelect(next.commitId)
    }
  }

  return (
    <ul
      ref={list}
      className="history-list"
      role="listbox"
      aria-label="Changes to this file"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {entries.map((entry) => (
        <li
          key={entry.commitId}
          role="option"
          aria-selected={entry.commitId === selected}
          data-commit-id={entry.commitId}
          className={`history-row${entry.commitId === selected ? ' is-selected' : ''}`}
          onClick={() => onSelect(entry.commitId)}
        >
          <span className="history-id">{entry.shortChangeId}</span>
          <span className={`history-summary${entry.summary ? '' : ' muted'}`}>
            {entry.isWorkingCopy ? '(working copy) ' : ''}
            {entry.summary || '(no description)'}
          </span>
          <span className="history-author">{entry.author}</span>
          <span className="history-time" title={entry.time}>
            <RelativeTime timestamp={entry.time} />
          </span>
        </li>
      ))}
    </ul>
  )
}

function ChangeDetail({
  entry,
  diff,
  send,
}: {
  entry: FileHistoryEntry
  diff: Diff | null
  send: Send
}) {
  return (
    <section className="history-detail" aria-label={`Change ${entry.shortChangeId}`}>
      <header className="history-detail-header">
        <div className="history-detail-title">
          <span className="history-id">{entry.shortChangeId}</span>
          <span className={`history-detail-summary${entry.summary ? '' : ' muted'}`}>
            {entry.isWorkingCopy ? '(working copy) ' : ''}
            {entry.summary || '(no description)'}
          </span>
        </div>
        <div className="history-detail-meta">
          {entry.author} · <RelativeTime timestamp={entry.time} />
        </div>
        <div className="history-detail-actions">
          <button
            className="link-button"
            onClick={() => send({ type: 'reveal', commitId: entry.commitId })}
          >
            <span className="codicon codicon-target" aria-hidden /> Show in graph
          </button>
          <button
            className="link-button"
            onClick={() => send({ type: 'openFile', commitId: entry.commitId })}
          >
            <span className="codicon codicon-go-to-file" aria-hidden /> Open file at this change
          </button>
        </div>
      </header>
      {diff === null ? (
        <p className="history-empty">Loading the diff…</p>
      ) : 'error' in diff ? (
        <p className="history-empty error-text">{diff.error}</p>
      ) : (
        <DiffView document={diff.document} />
      )}
    </section>
  )
}

function BlameView({
  blame,
  rows,
  onSelect,
}: {
  blame: FileBlame
  rows: BlameRow[]
  onSelect: (commitId: string) => void
}) {
  return (
    <div className="blame" role="table" aria-label="Blame">
      {rows.map((row) => {
        const change = row.run ? blame.changes[row.run.commitId] : undefined
        return (
          <div
            key={row.line}
            role="row"
            className={`blame-row${row.run ? ' is-run-start' : ''}${row.isRunEnd ? ' is-run-end' : ''}`}
          >
            <span role="cell" className="blame-gutter">
              {row.run && change && (
                <button
                  className="blame-change"
                  title={`${change.summary || '(no description)'}\n${change.author} · ${change.time}\nClick to show the change`}
                  onClick={() => onSelect(change.commitId)}
                >
                  <span className="history-id">{change.shortChangeId}</span>
                  <span className="blame-author">
                    {change.isWorkingCopy ? 'working copy' : change.author}
                  </span>
                  <span className="history-time">
                    <RelativeTime timestamp={change.time} />
                  </span>
                </button>
              )}
            </span>
            <span role="cell" className="blame-number">
              {row.line}
            </span>
            <span role="cell" className="blame-text">
              {row.text}
            </span>
          </div>
        )
      })}
    </div>
  )
}
