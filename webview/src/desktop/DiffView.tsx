import { Fragment, useMemo, useState } from 'react'
import type { DiffDocument, DiffFile } from '../../../shared/desktopProtocol'
import { parserFor } from '../editor/languages'
import { highlightLines, type Token } from '../editor/syntaxClasses'
import { FileTypeIcon } from '../graph/FileIcon'
import { diffHunks, patchHunks, segments, type DiffHunk, type DiffRow } from './diffModel'

const STATUS_LETTER: Record<DiffFile['status'], string> = {
  added: 'A',
  modified: 'M',
  removed: 'D',
  renamed: 'R',
  copied: 'C',
  changed: '~',
}

// The syntax tokens of each side's lines, when the language is known.
interface SideTokens {
  old: Token[][] | null
  new: Token[][] | null
}

const NO_TOKENS: SideTokens = { old: null, new: null }

function sideTokens(path: string, text: string | undefined): Token[][] | null {
  return text === undefined ? null : highlightLines(text, parserFor(path, text))
}

// A removed line has the old side's colors, every other line the new side's.
function rowTokens(row: DiffRow, tokens: SideTokens): Token[] | undefined {
  if (row.kind === 'note') {
    return undefined
  }
  if (row.kind === 'removed') {
    return row.oldLine === null ? undefined : tokens.old?.[row.oldLine - 1]
  }
  return row.newLine === null ? undefined : tokens.new?.[row.newLine - 1]
}

function Line({ row, tokens }: { row: DiffRow; tokens: SideTokens }) {
  const lineTokens = rowTokens(row, tokens)
  return (
    <tr className={`diff-row diff-${row.kind}`}>
      <td className="diff-num">{row.oldLine ?? ''}</td>
      <td className="diff-num">{row.newLine ?? ''}</td>
      <td className="diff-sign">
        {row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ''}
      </td>
      <td className="diff-text">
        {row.parts || lineTokens
          ? segments(row.text, lineTokens, row.parts).map((part, index) => {
              const text = <span className={part.cls}>{part.text}</span>
              return part.changed ? (
                <mark key={index}>{text}</mark>
              ) : (
                <Fragment key={index}>{text}</Fragment>
              )
            })
          : row.text || ' '}
      </td>
    </tr>
  )
}

function Hunks({ hunks, tokens = NO_TOKENS }: { hunks: readonly DiffHunk[]; tokens?: SideTokens }) {
  return (
    <table className="diff-table">
      <tbody>
        {hunks.map((hunk, index) => (
          <HunkRows key={index} hunk={hunk} tokens={tokens} />
        ))}
      </tbody>
    </table>
  )
}

function HunkRows({ hunk, tokens }: { hunk: DiffHunk; tokens: SideTokens }) {
  return (
    <>
      {hunk.header && (
        <tr className="diff-hunk">
          <td colSpan={4}>{hunk.header}</td>
        </tr>
      )}
      {hunk.rows.map((row, index) => (
        <Line key={index} row={row} tokens={tokens} />
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
  // Only an open file pays for parsing its two sides.
  const tokens = useMemo(
    (): SideTokens =>
      !isOpen || isBinary
        ? NO_TOKENS
        : {
            old: sideTokens(file.path, file.left?.text),
            new: sideTokens(file.path, file.right?.text),
          },
    [file, isOpen, isBinary],
  )
  const counts = lineCounts(hunks)
  return (
    <section className="diff-file" data-open={isOpen} id={`diff-${file.path}`}>
      <button className="diff-file-header" onClick={() => setIsOpen((v) => !v)}>
        <span className={`codicon codicon-chevron-${isOpen ? 'down' : 'right'}`} aria-hidden />
        <span className={`diff-status diff-status-${file.status}`}>
          {STATUS_LETTER[file.status]}
        </span>
        <FileTypeIcon path={file.path} />
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
          <Hunks hunks={hunks} tokens={tokens} />
        ))}
    </section>
  )
}

function FileView({ path, text }: { path: string; text: string }) {
  const rows = useMemo(
    (): DiffRow[] =>
      text
        .replace(/\n$/, '')
        .split('\n')
        .map((line, index) => ({ kind: 'same', text: line, oldLine: null, newLine: index + 1 })),
    [text],
  )
  const tokens = useMemo(
    (): SideTokens => ({ old: null, new: sideTokens(path, text) }),
    [path, text],
  )
  return (
    <div className="diff-view">
      <Hunks hunks={[{ header: '', rows }]} tokens={tokens} />
    </div>
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
    return <FileView path={document.path} text={document.text} />
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
