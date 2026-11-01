import { useMemo, useState } from 'react'
import type { DiffDocument, DiffFile } from '../../../shared/desktopProtocol'
import { diffHunks, patchHunks, type DiffHunk, type DiffRow } from './diffModel'

const STATUS_LETTER: Record<DiffFile['status'], string> = {
  added: 'A',
  modified: 'M',
  removed: 'D',
  renamed: 'R',
  copied: 'C',
  changed: '~',
}

function Line({ row }: { row: DiffRow }) {
  return (
    <tr className={`diff-row diff-${row.kind}`}>
      <td className="diff-num">{row.oldLine ?? ''}</td>
      <td className="diff-num">{row.newLine ?? ''}</td>
      <td className="diff-sign">
        {row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ''}
      </td>
      <td className="diff-text">
        {row.parts
          ? row.parts.map((part, index) =>
              part.changed ? (
                <mark key={index}>{part.text}</mark>
              ) : (
                <span key={index}>{part.text}</span>
              ),
            )
          : row.text || ' '}
      </td>
    </tr>
  )
}

function Hunks({ hunks }: { hunks: readonly DiffHunk[] }) {
  return (
    <table className="diff-table">
      <tbody>
        {hunks.map((hunk, index) => (
          <HunkRows key={index} hunk={hunk} />
        ))}
      </tbody>
    </table>
  )
}

function HunkRows({ hunk }: { hunk: DiffHunk }) {
  return (
    <>
      {hunk.header && (
        <tr className="diff-hunk">
          <td colSpan={4}>{hunk.header}</td>
        </tr>
      )}
      {hunk.rows.map((row, index) => (
        <Line key={index} row={row} />
      ))}
    </>
  )
}

function lineCounts(hunks: readonly DiffHunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const hunk of hunks) {
    for (const row of hunk.rows) {
      added += row.kind === 'added' ? 1 : 0
      removed += row.kind === 'removed' ? 1 : 0
    }
  }
  return { added, removed }
}

function FileDiff({ file, startOpen }: { file: DiffFile; startOpen: boolean }) {
  const [isOpen, setIsOpen] = useState(startOpen)
  const isBinary = Boolean(file.left?.isBinary || file.right?.isBinary)
  const hunks = useMemo(
    () => (isBinary ? [] : diffHunks(file.left?.text ?? null, file.right?.text ?? null)),
    [file, isBinary],
  )
  const counts = lineCounts(hunks)
  return (
    <section className="diff-file" data-open={isOpen} id={`diff-${file.path}`}>
      <button className="diff-file-header" onClick={() => setIsOpen((v) => !v)}>
        <span className={`codicon codicon-chevron-${isOpen ? 'down' : 'right'}`} aria-hidden />
        <span className={`diff-status diff-status-${file.status}`}>
          {STATUS_LETTER[file.status]}
        </span>
        <span className="diff-path">{file.path}</span>
        {!isBinary && (
          <span className="diff-counts">
            <span className="diff-count-added">+{counts.added}</span>
            <span className="diff-count-removed">−{counts.removed}</span>
          </span>
        )}
      </button>
      {isOpen &&
        (isBinary ? (
          <p className="diff-placeholder">{file.right?.text || file.left?.text}</p>
        ) : hunks.length === 0 ? (
          <p className="diff-placeholder">No changes in the content.</p>
        ) : (
          <Hunks hunks={hunks} />
        ))}
    </section>
  )
}

const OPEN_FILE_LIMIT = 12

export function DiffView({ document }: { document: DiffDocument }) {
  if (document.kind === 'patch') {
    return (
      <div className="diff-view">
        <Hunks hunks={patchHunks(document.text)} />
      </div>
    )
  }
  if (document.kind === 'file') {
    const rows: DiffRow[] = document.text
      .replace(/\n$/, '')
      .split('\n')
      .map((text, index) => ({ kind: 'same', text, oldLine: null, newLine: index + 1 }))
    return (
      <div className="diff-view">
        <Hunks hunks={[{ header: '', rows }]} />
      </div>
    )
  }
  return (
    <div className="diff-view">
      {document.files.map((file) => (
        <FileDiff
          key={`${document.title}\n${file.path}`}
          file={file}
          startOpen={
            document.focus ? file.path === document.focus : document.files.length <= OPEN_FILE_LIMIT
          }
        />
      ))}
      {document.files.length === 0 && <p className="diff-placeholder">This change has no files.</p>}
    </div>
  )
}
