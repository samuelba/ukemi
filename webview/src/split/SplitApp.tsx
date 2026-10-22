import { useEffect, useMemo, useState } from 'react'
import type {
  Segment,
  SplitFile,
  SplitHostMessage,
  SplitRequest,
  SplitSelection,
  SplitWebviewMessage,
} from '../../../shared/split'
import { changeIds } from '../../../shared/split'
import { postMessage } from '../shared/vscodeApi'

const CONTEXT_LINES = 3

type FileChoice = ReadonlySet<number> | 'whole'

const send = (message: SplitWebviewMessage) => postMessage(message)

function lines(text: string): string[] {
  const parts = text.split('\n')
  if (parts.at(-1) === '') {
    parts.pop()
  }
  return parts
}

function isWholeFileOnly(file: SplitFile): boolean {
  return file.isBinary || file.sourcePath !== file.path || changeIds(file).length === 0
}

function isFileSelected(file: SplitFile, choice: FileChoice | undefined): 'all' | 'some' | 'none' {
  if (!choice) {
    return 'none'
  }
  if (choice === 'whole') {
    return 'all'
  }
  const ids = changeIds(file)
  if (choice.size === 0) {
    return 'none'
  }
  return choice.size === ids.length ? 'all' : 'some'
}

function Checkbox({
  state,
  onChange,
  label,
}: {
  state: 'all' | 'some' | 'none'
  onChange: () => void
  label: string
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={state === 'all'}
      ref={(el) => {
        if (el) {
          el.indeterminate = state === 'some'
        }
      }}
      onChange={onChange}
    />
  )
}

function Hunk({
  segments,
  index,
  isSelected,
  onToggle,
}: {
  segments: Segment[]
  index: number
  isSelected: boolean
  onToggle: () => void
}) {
  const segment = segments[index]
  if (!segment || segment.kind !== 'change') {
    return null
  }
  const before = segments[index - 1]
  const after = segments[index + 1]
  const contextBefore = before?.kind === 'same' ? lines(before.text).slice(-CONTEXT_LINES) : []
  const contextAfter = after?.kind === 'same' ? lines(after.text).slice(0, CONTEXT_LINES) : []
  return (
    <div className={`hunk${isSelected ? ' selected' : ''}`}>
      <label className="hunk-head">
        <Checkbox
          state={isSelected ? 'all' : 'none'}
          onChange={onToggle}
          label={`Hunk ${segment.id + 1}`}
        />
        <span>Change {segment.id + 1}</span>
      </label>
      <pre className="hunk-body" onClick={onToggle}>
        {contextBefore.map((line, i) => (
          <div key={`b${i}`} className="line context">
            {' '}
            {line}
          </div>
        ))}
        {lines(segment.removed).map((line, i) => (
          <div key={`r${i}`} className="line removed">
            -{line}
          </div>
        ))}
        {lines(segment.added).map((line, i) => (
          <div key={`a${i}`} className="line added">
            +{line}
          </div>
        ))}
        {contextAfter.map((line, i) => (
          <div key={`c${i}`} className="line context">
            {' '}
            {line}
          </div>
        ))}
      </pre>
    </div>
  )
}

function FileSection({
  file,
  choice,
  onChange,
}: {
  file: SplitFile
  choice: FileChoice | undefined
  onChange: (choice: FileChoice | undefined) => void
}) {
  const [isOpen, setIsOpen] = useState(true)
  const state = isFileSelected(file, choice)
  const wholeOnly = isWholeFileOnly(file)
  const toggleFile = () => {
    if (state === 'all') {
      onChange(undefined)
    } else {
      onChange(wholeOnly ? 'whole' : new Set(changeIds(file)))
    }
  }
  const toggleHunk = (id: number) => {
    const current = choice instanceof Set ? new Set(choice) : new Set<number>()
    if (!current.delete(id)) {
      current.add(id)
    }
    onChange(current.size > 0 ? current : undefined)
  }
  const renamed = file.sourcePath !== file.path
  return (
    <section className="split-file">
      <div className="split-file-head">
        <button
          className="icon-button"
          onClick={() => setIsOpen(!isOpen)}
          aria-label={isOpen ? 'Collapse' : 'Expand'}
        >
          <i className={`codicon codicon-chevron-${isOpen ? 'down' : 'right'}`} />
        </button>
        <label>
          <Checkbox state={state} onChange={toggleFile} label={file.path} />
          <span className={`status status-${file.status}`}>{file.status}</span>
          <span className="path">{renamed ? `${file.sourcePath} → ${file.path}` : file.path}</span>
        </label>
      </div>
      {isOpen &&
        (wholeOnly ? (
          <div className="muted whole-note">
            {file.isBinary
              ? 'Binary file. Select the whole file.'
              : renamed
                ? 'Renamed file. Select the whole file.'
                : 'No text changes.'}
          </div>
        ) : (
          file.segments.map((segment, index) =>
            segment.kind === 'change' ? (
              <Hunk
                key={segment.id}
                segments={file.segments}
                index={index}
                isSelected={choice instanceof Set && choice.has(segment.id)}
                onToggle={() => toggleHunk(segment.id)}
              />
            ) : null,
          )
        ))}
    </section>
  )
}

export function SplitApp() {
  const [request, setRequest] = useState<SplitRequest | null>(null)
  const [choices, setChoices] = useState<ReadonlyMap<string, FileChoice>>(new Map())
  const [message, setMessage] = useState('')

  useEffect(() => {
    const onMessage = (event: MessageEvent<SplitHostMessage>) => {
      if (event.data.type === 'load') {
        setRequest(event.data.request)
      }
    }
    window.addEventListener('message', onMessage)
    send({ type: 'ready' })
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const selections = useMemo<SplitSelection[]>(
    () =>
      [...choices].map(([path, choice]) =>
        choice === 'whole'
          ? { path, hunks: [], isWholeFile: true }
          : { path, hunks: [...choice], isWholeFile: false },
      ),
    [choices],
  )

  if (!request) {
    return <div className="muted padded">Loading changes…</div>
  }

  const update = (path: string, choice: FileChoice | undefined) =>
    setChoices((prev) => {
      const next = new Map(prev)
      if (choice) {
        next.set(path, choice)
      } else {
        next.delete(path)
      }
      return next
    })

  return (
    <div className="split">
      <header className="split-header">
        <h1>Split “{request.title || '(no description)'}”</h1>
        <p className="muted">
          Select the changes for a new change before this one. The rest stays in “
          {request.title || '(no description)'}”.
        </p>
        <textarea
          rows={2}
          value={message}
          placeholder="Description of the new change"
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="split-buttons">
          <button className="button secondary" onClick={() => send({ type: 'cancel' })}>
            Cancel
          </button>
          <button
            className="button"
            disabled={selections.length === 0}
            onClick={() => send({ type: 'apply', message, selections })}
          >
            Split
          </button>
        </div>
      </header>
      {request.files.map((file) => (
        <FileSection
          key={file.path}
          file={file}
          choice={choices.get(file.path)}
          onChange={(c) => update(file.path, c)}
        />
      ))}
    </div>
  )
}
