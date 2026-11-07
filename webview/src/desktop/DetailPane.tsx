import { useRef, useState } from 'react'
import type {
  ChangeDetail,
  DesktopRendererMessage,
  DiffDocument,
  SidePanelRow,
} from '../../../shared/desktopProtocol'
import type { ViewSettings } from '../../../shared/protocol'
import { FileList } from '../graph/FileList'
import { relativeTime, splitId } from '../shared/format'
import { postMessage } from '../shared/hostApi'
import { DiffOptionButtons } from './diffOptions'
import { DiffView } from './DiffView'
import { openRowMenu, RowActions } from './RowActions'
import { Splitter } from './Splitter'

const DIFF_KEY = 'ukemi.detail.diffShare'
const DEFAULT_DIFF_SHARE = 0.6
const MIN_SHARE = 0.15
const MAX_SHARE = 0.9

function send(message: DesktopRendererMessage): void {
  postMessage(message)
}

function readShare(): number {
  const saved = Number(localStorage.getItem(DIFF_KEY))
  return saved >= MIN_SHARE && saved <= MAX_SHARE ? saved : DEFAULT_DIFF_SHARE
}

function ChangeHeader({ detail, now }: { detail: ChangeDetail; now: number }) {
  const { commit, repoId } = detail
  const change = splitId(commit.changeId, commit.changePrefix, 8)
  const hash = splitId(commit.commitId, commit.commitPrefix, 8)
  const [subject = '', ...body] = commit.description.trimEnd().split('\n')
  return (
    <header className="detail-header">
      <div className="detail-ids">
        <span className="detail-id" title={commit.changeId}>
          <b>{change.prefix}</b>
          {change.rest}
        </span>
        <span className="detail-hash" title={commit.commitId}>
          <b>{hash.prefix}</b>
          {hash.rest}
        </span>
        {commit.isWorkingCopy && <span className="detail-tag detail-tag-here">@ working copy</span>}
        {commit.isImmutable && <span className="detail-tag">immutable</span>}
        {commit.hasConflict &&
          (commit.isImmutable ? (
            <span className="detail-tag detail-tag-conflict">conflict</span>
          ) : (
            <button
              className="detail-tag detail-tag-conflict"
              title="Resolve the conflicts of this change"
              onClick={() =>
                send({
                  type: 'desktop.run',
                  command: 'ukemi.conflict.resolve',
                  arg: { repoId, commitId: commit.commitId },
                })
              }
            >
              conflict · resolve
            </button>
          ))}
      </div>
      <h1 className={`detail-subject${subject ? '' : ' is-empty'}`}>
        {subject || '(no description)'}
      </h1>
      {body.length > 0 && <p className="detail-body">{body.join('\n').trim()}</p>}
      <p className="detail-meta">
        {commit.author.name} · {relativeTime(commit.author.timestamp, now)}
      </p>
    </header>
  )
}

function Evolution({ rows }: { rows: SidePanelRow[] | null }) {
  const [isOpen, setIsOpen] = useState(true)
  return (
    <section className="detail-section">
      <button
        className="detail-section-bar"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
      >
        <span className={`codicon codicon-chevron-${isOpen ? 'down' : 'right'}`} aria-hidden />
        <h2>Evolution {rows && <span className="detail-count">{rows.length}</span>}</h2>
      </button>
      {isOpen &&
        (rows === null ? (
          <p className="detail-empty">Loading…</p>
        ) : rows.length <= 1 ? (
          <p className="detail-empty">This change has not been rewritten.</p>
        ) : (
          <ol className="evolution">
            {rows.map((row) => (
              <li
                key={row.id}
                className={`evolution-row${row.defaultCommand ? ' is-openable' : ''}`}
                title={row.tooltip}
                onClick={() =>
                  row.defaultCommand &&
                  send({ type: 'desktop.run', command: row.defaultCommand, arg: row.arg })
                }
                onContextMenu={(e) => openRowMenu(row, e)}
              >
                <span className={`codicon codicon-${row.icon} evolution-dot`} aria-hidden />
                <span className="evolution-label">{row.label}</span>
                <span className="evolution-description">{row.description}</span>
                <RowActions row={row} />
              </li>
            ))}
          </ol>
        ))}
    </section>
  )
}

function Summary({
  detail,
  now,
  settings,
}: {
  detail: ChangeDetail
  now: number
  settings: ViewSettings
}) {
  return (
    <div className="detail-summary">
      <ChangeHeader detail={detail} now={now} />
      <section className="detail-section">
        <div className="detail-files-bar">
          <h2>
            Files <span className="detail-count">{detail.files.length}</span>
          </h2>
          {detail.files.length > 0 && (
            <button
              className="button-quiet"
              onClick={() => send({ type: 'desktop.loadDiff', commitId: detail.commit.commitId })}
            >
              <span className="codicon codicon-diff-multiple" aria-hidden /> Show all
            </button>
          )}
        </div>
        <div className="detail-file-list">
          <FileList
            commit={detail.commit}
            files={detail.files}
            repoId={detail.repoId}
            showFullPaths={settings.showFullPaths}
            showLineStats={settings.showLineStats}
            changedFilesView={settings.changedFilesView}
            level={1}
          />
        </div>
      </section>
      <Evolution rows={detail.evolution} />
    </div>
  )
}

function DiffPanel({
  diff,
  isMaximized,
  onToggleMaximize,
  onClose,
}: {
  diff: DiffDocument
  isMaximized: boolean
  onToggleMaximize: () => void
  onClose: () => void
}) {
  return (
    <div className="detail-diff">
      <header className="detail-diff-bar">
        <h2 className="detail-diff-title" title={diff.title}>
          {diff.title}
        </h2>
        {diff.kind !== 'file' && <DiffOptionButtons hasSides={diff.kind === 'files'} />}
        <button
          className="icon-button"
          title={isMaximized ? 'Restore' : 'Maximize'}
          aria-pressed={isMaximized}
          onClick={onToggleMaximize}
        >
          <span
            className={`codicon codicon-${isMaximized ? 'screen-normal' : 'screen-full'}`}
            aria-hidden
          />
        </button>
        <button className="icon-button" title="Close the diff (Esc)" onClick={onClose}>
          <span className="codicon codicon-close" aria-hidden />
        </button>
      </header>
      <DiffView document={diff} />
    </div>
  )
}

// The selected change: what it is, its files and versions, and the diff opened last.
export function DetailPane({
  detail,
  diff,
  now,
  settings,
  onCloseDiff,
}: {
  detail: ChangeDetail | null
  diff: DiffDocument | null
  now: number
  settings: ViewSettings
  onCloseDiff: () => void
}) {
  const [share, setShare] = useState(readShare)
  const [isMaximized, setIsMaximized] = useState(false)
  const pane = useRef<HTMLElement>(null)

  const resize = (delta: number) => {
    const height = pane.current?.clientHeight ?? 1
    setShare((current) => {
      const next = Math.min(MAX_SHARE, Math.max(MIN_SHARE, current - delta / height))
      localStorage.setItem(DIFF_KEY, String(next))
      return next
    })
  }

  const showSummary = detail && !(diff && isMaximized)
  const rows = diff && showSummary ? `minmax(0, ${1 - share}fr) 1px minmax(0, ${share}fr)` : '1fr'
  return (
    <section
      ref={pane}
      className="detail"
      style={{ gridTemplateRows: rows }}
      aria-label="Change details"
      onKeyDown={(e) => e.key === 'Escape' && diff && onCloseDiff()}
    >
      {showSummary && <Summary detail={detail} now={now} settings={settings} />}
      {!detail && !diff && (
        <div className="detail-placeholder">
          <span className="codicon codicon-git-commit" aria-hidden />
          <p>Select a change to see its files and diff.</p>
        </div>
      )}
      {diff && showSummary && (
        <Splitter
          label="Resize the diff"
          direction="rows"
          onDrag={resize}
          onReset={() => {
            localStorage.removeItem(DIFF_KEY)
            setShare(DEFAULT_DIFF_SHARE)
          }}
        />
      )}
      {diff && (
        <DiffPanel
          diff={diff}
          isMaximized={isMaximized || !detail}
          onToggleMaximize={() => setIsMaximized((v) => !v)}
          onClose={() => {
            setIsMaximized(false)
            onCloseDiff()
          }}
        />
      )}
    </section>
  )
}
