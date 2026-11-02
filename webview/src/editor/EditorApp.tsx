import type { Text } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import { useEffect, useRef, useState } from 'react'
import { fileSideLabel, fileSideTitle, sharedSideCount } from '../../../shared/conflictMarkers'
import type {
  EditorHostMessage,
  EditorState as FileState,
  EditorWebviewMessage,
} from '../../../shared/editor'
import { useHostMessages } from '../shared/hooks'
import { useSend } from '../shared/hostChannel'
import { LoadingScreen } from '../shared/LoadingMark'
import { createState } from './codemirror'
import {
  acceptSideEverywhere,
  conflictBlocks,
  currentConflict,
  nextConflict,
  previousConflict,
  sideColor,
} from './conflicts'
import { dirtyTabs } from './dirtyTabs'

interface SideAction {
  title: string
  label: string
}

interface ConflictSummary {
  count: number
  // Zero-based; -1 before the first conflict.
  current: number
  sides: SideAction[]
}

const NO_CONFLICTS: ConflictSummary = { count: 0, current: -1, sides: [] }

function summarize(view: EditorView): ConflictSummary {
  const blocks = conflictBlocks(view.state)
  if (blocks.length === 0) {
    return NO_CONFLICTS
  }
  const sideCount = sharedSideCount(blocks)
  return {
    count: blocks.length,
    current: currentConflict(view.state),
    sides: Array.from({ length: sideCount }, (_, sideIndex) => ({
      title: fileSideTitle(blocks, sideIndex),
      label: fileSideLabel(blocks, sideIndex),
    })),
  }
}

function sameSummary(a: ConflictSummary, b: ConflictSummary): boolean {
  return (
    a.count === b.count &&
    a.current === b.current &&
    a.sides.map((s) => s.title + s.label).join() === b.sides.map((s) => s.title + s.label).join()
  )
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

// Edits one file of a change. Conflict markers get colors and Accept buttons, so the same tab
// resolves the change's conflicts one file after another.
export function EditorApp({ tabId }: { tabId: string }) {
  const send = useSend<EditorWebviewMessage>()
  const [file, setFile] = useState<FileState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDirty, setDirty] = useState(false)
  const [summary, setSummary] = useState<ConflictSummary>(NO_CONFLICTS)
  // Every file that was conflicted while the tab was open, so resolved ones keep their row.
  const [seenConflicts, setSeenConflicts] = useState<readonly string[]>([])
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const loadedRef = useRef<Text | null>(null)
  const fileRef = useRef<FileState | null>(null)
  const dirtyRef = useRef(false)

  const markDirty = (dirty: boolean) => {
    dirtyRef.current = dirty
    if (dirty) {
      dirtyTabs.add(tabId)
    } else {
      dirtyTabs.delete(tabId)
    }
    setDirty(dirty)
  }

  const save = () => {
    const view = viewRef.current
    const current = fileRef.current
    if (view && current && !current.readOnly) {
      setError(null)
      send({ type: 'save', text: view.state.sliceDoc(), baseHash: current.baseHash })
    }
  }

  const onUpdate = (update: ViewUpdate) => {
    if (update.docChanged) {
      const loaded = loadedRef.current
      markDirty(loaded ? !update.state.doc.eq(loaded) : true)
    }
    if (update.docChanged || update.selectionSet) {
      const next = summarize(update.view)
      setSummary((prev) => (sameSummary(prev, next) ? prev : next))
    }
  }

  useHostMessages<EditorHostMessage>(
    (message) => {
      switch (message.type) {
        case 'load':
          setError(null)
          setFile(message.state)
          setSeenConflicts((seen) => [
            ...seen,
            ...message.state.conflictedPaths.filter((path) => !seen.includes(path)),
          ])
          return
        case 'busy':
          setBusy(message.label)
          return
        case 'error':
          setError(message.text)
          return
        case 'show':
          send({ type: 'openPath', path: message.path, isDirty: dirtyRef.current })
          return
      }
    },
    { type: 'ready' } satisfies EditorWebviewMessage,
  )

  // A new load replaces the document, its undo history and the read-only state.
  useEffect(() => {
    const host = hostRef.current
    if (!file || !host) {
      return
    }
    fileRef.current = file
    const state = createState(file.text, {
      path: file.path,
      readOnly: file.readOnly !== null,
      onSave: save,
      onUpdate,
    })
    loadedRef.current = state.doc
    if (viewRef.current) {
      viewRef.current.setState(state)
    } else {
      viewRef.current = new EditorView({ state, parent: host })
    }
    markDirty(false)
    setSummary(summarize(viewRef.current))
    // The callbacks read refs, so a load is the only reason to rebuild the state.
  }, [file])

  useEffect(
    () => () => {
      viewRef.current?.destroy()
      viewRef.current = null
      dirtyTabs.delete(tabId)
    },
    [tabId],
  )

  const view = viewRef.current
  const resolved = file ? seenConflicts.filter((p) => !file.conflictedPaths.includes(p)) : []
  const showFiles = seenConflicts.length > 0
  const allResolved = file !== null && showFiles && file.conflictedPaths.length === 0

  return (
    <div className="editor-tab">
      {!file && !error && <LoadingScreen heading="Opening file…" />}
      {file && (
        <header className="editor-bar">
          <div className="editor-title">
            <span className="editor-path" title={file.path}>
              {file.path}
            </span>
            {isDirty && <span className="editor-dirty" aria-label="Unsaved edits" />}
            <span
              className={`editor-badge${file.isWorkingCopy ? ' is-working-copy' : ''}`}
              title={
                file.isWorkingCopy
                  ? 'Saving writes the file in the working copy.'
                  : `Saving rewrites ${file.changeLabel} and rebases its descendants.`
              }
            >
              {file.isWorkingCopy ? 'working copy' : `rewrites ${file.changeLabel}`}
            </span>
          </div>
          {summary.count > 0 && (
            <div className="editor-conflicts" role="group" aria-label="Conflicts">
              <button
                className="icon-button"
                aria-label="Previous conflict (Shift+F7)"
                title="Previous conflict (Shift+F7)"
                onClick={() => view && previousConflict(view)}
              >
                <span className="codicon codicon-arrow-up" aria-hidden />
              </button>
              <span className="editor-count">
                {summary.current < 0 ? '–' : summary.current + 1} of {summary.count}
              </span>
              <button
                className="icon-button"
                aria-label="Next conflict (F7)"
                title="Next conflict (F7)"
                onClick={() => view && nextConflict(view)}
              >
                <span className="codicon codicon-arrow-down" aria-hidden />
              </button>
              {summary.sides.map((side, sideIndex) => (
                <button
                  key={sideIndex}
                  className="button secondary"
                  title={`Keep side ${sideIndex + 1} in every conflict${side.label ? `: ${side.label}` : ''}`}
                  disabled={file.readOnly !== null}
                  onClick={() => view && acceptSideEverywhere(view, sideIndex)}
                >
                  <span className={`cm-conflict-swatch ${sideColor(sideIndex)}`} aria-hidden />
                  All {side.title}
                </button>
              ))}
            </div>
          )}
          <div className="editor-actions">
            {file.isWorkingCopy && (
              <button
                className="icon-button"
                aria-label="Open in the system editor"
                title="Open in the system editor"
                onClick={() => send({ type: 'openExternal' })}
              >
                <span className="codicon codicon-go-to-file" aria-hidden />
              </button>
            )}
            <button
              className="button secondary"
              disabled={busy !== null}
              title="Load the file again and drop your edits"
              onClick={() => send({ type: 'reload' })}
            >
              Revert
            </button>
            <button
              className="button"
              disabled={busy !== null || file.readOnly !== null || !isDirty}
              title="Save (Ctrl+S)"
              onClick={save}
            >
              {busy ?? 'Save'}
            </button>
          </div>
        </header>
      )}
      {error && <div className="editor-banner is-error">{error}</div>}
      {file?.readOnly && <div className="editor-banner">{file.readOnly}</div>}
      {allResolved && (
        <div className="editor-banner is-done">
          <span className="codicon codicon-pass" aria-hidden /> All conflicts in {file.changeLabel}{' '}
          are resolved.
        </div>
      )}
      <div className="editor-body" hidden={!file}>
        {showFiles && file && (
          <nav className="editor-files" aria-label="Conflicted files">
            {[...file.conflictedPaths, ...resolved].map((path) => {
              const isResolved = resolved.includes(path)
              return (
                <button
                  key={path}
                  className={`editor-file${path === file.path ? ' is-active' : ''}`}
                  title={path}
                  disabled={isResolved}
                  onClick={() => send({ type: 'openPath', path, isDirty: dirtyRef.current })}
                >
                  <span
                    className={`codicon codicon-${isResolved ? 'check' : 'warning'}`}
                    aria-hidden
                  />
                  {fileName(path)}
                </button>
              )
            })}
          </nav>
        )}
        <div className="editor-host" ref={hostRef} />
      </div>
    </div>
  )
}
