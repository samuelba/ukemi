import { Fragment, useMemo, useState } from 'react'
import type { DiffDocument, DiffFile } from '../../../shared/desktopProtocol'
import { parserFor } from '../editor/languages'
import { highlightLines, type Token } from '../editor/syntaxClasses'
import { FileTypeIcon } from '../graph/FileIcon'
import {
  dataUrlBytes,
  diffHunks,
  EXPAND_STEP,
  expandHunks,
  formatBytes,
  isLargeDiff,
  patchHunks,
  revealMore,
  segments,
  splitRows,
  svgDataUrl,
  type DiffHunk,
  type DiffPart,
  type DiffRow,
  type GapReveals,
  type ShownHunk,
  type SplitRow,
} from './diffModel'
import { useDiffOptions, type DiffOptions } from './diffOptions'

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

type Side = 'old' | 'new'
type Layout = DiffOptions['layout']

const NO_TOKENS: SideTokens = { old: null, new: null }
const NO_REVEALS: GapReveals = {}

function sideTokens(path: string, text: string | undefined): Token[][] | null {
  return text === undefined ? null : highlightLines(text, parserFor(path, text))
}

// A line's colors come from the side it is shown for. In one column, a removed line has the old
// side's colors and every other line the new side's.
function rowTokens(
  row: DiffRow,
  tokens: SideTokens,
  side: Side = row.kind === 'removed' ? 'old' : 'new',
): Token[] | undefined {
  if (row.kind === 'note') {
    return undefined
  }
  if (side === 'old') {
    return row.oldLine === null ? undefined : tokens.old?.[row.oldLine - 1]
  }
  return row.newLine === null ? undefined : tokens.new?.[row.newLine - 1]
}

function LineText({
  text,
  tokens,
  parts,
}: {
  text: string
  tokens: Token[] | undefined
  parts: DiffPart[] | undefined
}) {
  if (!parts && !tokens) {
    return <>{text || ' '}</>
  }
  return (
    <>
      {segments(text, tokens, parts).map((part, index) => {
        const span = <span className={part.cls}>{part.text}</span>
        return part.changed ? (
          <mark key={index}>{span}</mark>
        ) : (
          <Fragment key={index}>{span}</Fragment>
        )
      })}
    </>
  )
}

function Line({ row, tokens }: { row: DiffRow; tokens: SideTokens }) {
  return (
    <tr className={`diff-row diff-${row.kind}`}>
      <td className="diff-num">{row.oldLine ?? ''}</td>
      <td className="diff-num">{row.newLine ?? ''}</td>
      <td className="diff-sign">
        {row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ''}
      </td>
      <td className="diff-text">
        <LineText text={row.text} tokens={rowTokens(row, tokens)} parts={row.parts} />
      </td>
    </tr>
  )
}

// One side of a side-by-side row. A missing line is padding across from a longer run.
function SplitCells({
  row,
  side,
  tokens,
}: {
  row: DiffRow | null
  side: Side
  tokens: SideTokens
}) {
  if (!row) {
    return (
      <>
        <td className="diff-num diff-empty" />
        <td className="diff-text diff-empty" />
      </>
    )
  }
  const text = side === 'old' ? (row.oldText ?? row.text) : row.text
  return (
    <>
      <td className={`diff-num diff-${row.kind}`}>
        {(side === 'old' ? row.oldLine : row.newLine) ?? ''}
      </td>
      <td className={`diff-text diff-${row.kind}`}>
        <LineText text={text} tokens={rowTokens(row, tokens, side)} parts={row.parts} />
      </td>
    </>
  )
}

function SplitLine({ row, tokens }: { row: SplitRow; tokens: SideTokens }) {
  if (row.left?.kind === 'note') {
    return (
      <tr className="diff-row diff-note">
        <td className="diff-num" />
        <td className="diff-text" colSpan={3}>
          {row.left.text || ' '}
        </td>
      </tr>
    )
  }
  return (
    <tr className="diff-row">
      <SplitCells row={row.left} side="old" tokens={tokens} />
      <SplitCells row={row.right} side="new" tokens={tokens} />
    </tr>
  )
}

// A hunk, and when its file's sides are known, the hidden gap its header opens.
type HunkToShow = DiffHunk & Partial<Pick<ShownHunk, 'gap' | 'hiddenAbove'>>

function Hunks({
  hunks,
  tokens = NO_TOKENS,
  layout = 'unified',
  trailing,
  onExpand,
}: {
  hunks: readonly HunkToShow[]
  tokens?: SideTokens
  layout?: Layout
  trailing?: { gap: number; hidden: number }
  onExpand?: (gap: number) => void
}) {
  const isSplit = layout === 'split'
  return (
    <table className={`diff-table${isSplit ? ' diff-split' : ''}`}>
      {isSplit && (
        <colgroup>
          <col className="diff-col-num" />
          <col />
          <col className="diff-col-num" />
          <col />
        </colgroup>
      )}
      <tbody>
        {hunks.map((hunk, index) => (
          <HunkRows key={index} hunk={hunk} tokens={tokens} isSplit={isSplit} onExpand={onExpand} />
        ))}
        {onExpand && trailing && trailing.hidden > 0 && (
          <ExpandRow hidden={trailing.hidden} onClick={() => onExpand(trailing.gap)} />
        )}
      </tbody>
    </table>
  )
}

function hiddenLabel(hidden: number): string {
  return `${hidden} hidden ${hidden === 1 ? 'line' : 'lines'}`
}

// A hunk's header, or the end of a file, that shows more of the unchanged lines it hides.
function ExpandRow({
  header,
  hidden,
  onClick,
}: {
  header?: string
  hidden: number
  onClick: () => void
}) {
  return (
    <tr className="diff-hunk">
      <td colSpan={4}>
        <button
          className="diff-hunk-expand"
          title={`Show ${Math.min(hidden, EXPAND_STEP)} more ${hidden === 1 ? 'line' : 'lines'}`}
          onClick={onClick}
        >
          <span className="codicon codicon-unfold" aria-hidden />
          {header && <span>{header}</span>}
          <span className="diff-hunk-hidden">{hiddenLabel(hidden)}</span>
        </button>
      </td>
    </tr>
  )
}

function HunkRows({
  hunk,
  tokens,
  isSplit,
  onExpand,
}: {
  hunk: HunkToShow
  tokens: SideTokens
  isSplit: boolean
  onExpand?: (gap: number) => void
}) {
  const { gap, hiddenAbove = 0 } = hunk
  return (
    <>
      {onExpand && gap !== undefined && hiddenAbove > 0 ? (
        <ExpandRow header={hunk.header} hidden={hiddenAbove} onClick={() => onExpand(gap)} />
      ) : (
        hunk.header && (
          <tr className="diff-hunk">
            <td colSpan={4}>{hunk.header}</td>
          </tr>
        )
      )}
      {isSplit
        ? splitRows(hunk.rows).map((row, index) => (
            <SplitLine key={index} row={row} tokens={tokens} />
          ))
        : hunk.rows.map((row, index) => <Line key={index} row={row} tokens={tokens} />)}
    </>
  )
}

// A smaller image, like an icon, is scaled up by a whole factor so its pixels stay sharp.
const MIN_IMAGE_SIZE = 64

function ImageSide({ label, src }: { label: string; src: string }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [isBroken, setIsBroken] = useState(false)
  const scale = size
    ? Math.max(1, Math.floor(MIN_IMAGE_SIZE / Math.max(size.width, size.height, 1)))
    : 1
  return (
    <figure className="diff-image">
      <div className="diff-image-frame">
        {isBroken ? (
          <p className="diff-placeholder">This image cannot be shown.</p>
        ) : (
          <img
            src={src}
            alt={label}
            className={scale > 1 ? 'is-scaled' : undefined}
            style={size && scale > 1 ? { width: size.width * scale } : undefined}
            onLoad={(e) =>
              setSize({
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              })
            }
            onError={() => setIsBroken(true)}
          />
        )}
      </div>
      <figcaption>
        {[label, size && `${size.width} × ${size.height}`, formatBytes(dataUrlBytes(src))]
          .filter(Boolean)
          .join(' · ')}
      </figcaption>
    </figure>
  )
}

// The two versions of an image next to each other. An added or removed image has one side.
function ImageDiff({ left, right }: { left: string | null; right: string | null }) {
  return (
    <div className="diff-images">
      {left && <ImageSide label={right ? 'Before' : 'Removed'} src={left} />}
      {right && <ImageSide label={left ? 'After' : 'Added'} src={right} />}
    </div>
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

function FileDiff({
  file,
  startOpen,
  options,
}: {
  file: DiffFile
  startOpen: boolean
  options: DiffOptions
}) {
  const [isOpen, setIsOpen] = useState(startOpen)
  const [showLarge, setShowLarge] = useState(false)
  const [showSvg, setShowSvg] = useState(false)
  const isBinary = Boolean(file.left?.isBinary || file.right?.isBinary)
  const left = file.left?.text ?? null
  const right = file.right?.text ?? null
  const isSvg = !isBinary && /\.svg$/i.test(file.path)
  const images =
    file.left?.image || file.right?.image
      ? { left: file.left?.image ?? null, right: file.right?.image ?? null }
      : isSvg && showSvg
        ? {
            left: left === null ? null : svgDataUrl(left),
            right: right === null ? null : svgDataUrl(right),
          }
        : null
  const isLarge = useMemo(() => !isBinary && isLargeDiff(left, right), [isBinary, left, right])
  // A large file is diffed only once it is open and asked for.
  const isDiffed = !isBinary && (!isLarge || (isOpen && showLarge))
  const { ignoreWhitespace, fullFile } = options
  const hunks = useMemo(
    () => (isDiffed ? diffHunks(left, right, { ignoreWhitespace, fullFile }) : null),
    [isDiffed, left, right, ignoreWhitespace, fullFile],
  )
  // What the headers have shown so far, for these hunks only: new hunks start folded again.
  const [reveal, setReveal] = useState<{ hunks: DiffHunk[] | null; gaps: GapReveals }>({
    hunks: null,
    gaps: NO_REVEALS,
  })
  const gaps = reveal.hunks === hunks ? reveal.gaps : NO_REVEALS
  const shown = useMemo(() => {
    if (!hunks) {
      return null
    }
    // The whole file hides nothing, so its one hunk needs no header.
    return fullFile
      ? { hunks: hunks.map((hunk) => ({ ...hunk, header: '' })), trailing: undefined }
      : expandHunks(hunks, left, right, gaps, { ignoreWhitespace })
  }, [hunks, fullFile, left, right, gaps, ignoreWhitespace])
  const onExpand = (gap: number) =>
    hunks && setReveal({ hunks, gaps: revealMore(gaps, gap, hunks.length) })
  // Only an open file pays for parsing its two sides, and a large one is not colored.
  const tokens = useMemo(
    (): SideTokens =>
      !isOpen || !hunks || isLarge
        ? NO_TOKENS
        : {
            old: sideTokens(file.path, file.left?.text),
            new: sideTokens(file.path, file.right?.text),
          },
    [file, isOpen, hunks, isLarge],
  )
  const counts = hunks ? lineCounts(hunks) : null
  return (
    <section className="diff-file" data-open={isOpen} id={`diff-${file.path}`}>
      <button className="diff-file-header" onClick={() => setIsOpen((v) => !v)}>
        <span className={`codicon codicon-chevron-${isOpen ? 'down' : 'right'}`} aria-hidden />
        <span className={`diff-status diff-status-${file.status}`}>
          {STATUS_LETTER[file.status]}
        </span>
        <FileTypeIcon path={file.path} />
        <span className="diff-path">{file.path}</span>
        {counts && (
          <span className="diff-counts">
            <span className="diff-count-added">+{counts.added}</span>
            <span className="diff-count-removed">−{counts.removed}</span>
          </span>
        )}
      </button>
      {isOpen && isSvg && (
        <p className="diff-file-tools">
          <button className="link-button" onClick={() => setShowSvg((v) => !v)}>
            {showSvg ? 'Show the text' : 'Show the image'}
          </button>
        </p>
      )}
      {isOpen &&
        (images ? (
          <ImageDiff left={images.left} right={images.right} />
        ) : isBinary ? (
          <p className="diff-placeholder">{file.right?.text || file.left?.text}</p>
        ) : !hunks || !shown ? (
          <p className="diff-placeholder">
            This file is too large to show at once.{' '}
            <button className="link-button" onClick={() => setShowLarge(true)}>
              Show the diff
            </button>
          </p>
        ) : hunks.length === 0 ? (
          <p className="diff-placeholder">
            {ignoreWhitespace && left !== right
              ? 'Only whitespace changed.'
              : 'No changes in the content.'}
          </p>
        ) : (
          <Hunks
            hunks={shown.hunks}
            tokens={tokens}
            layout={options.layout}
            trailing={shown.trailing}
            onExpand={fullFile ? undefined : onExpand}
          />
        ))}
    </section>
  )
}

function FileView({ path, text, image }: { path: string; text: string; image?: string }) {
  const rows = useMemo(
    (): DiffRow[] =>
      text
        .replace(/\n$/, '')
        .split('\n')
        .map((line, index) => ({ kind: 'same', text: line, oldLine: null, newLine: index + 1 })),
    [text],
  )
  const tokens = useMemo(
    (): SideTokens =>
      image || isLargeDiff(null, text) ? NO_TOKENS : { old: null, new: sideTokens(path, text) },
    [path, text, image],
  )
  return (
    <div className="diff-view">
      {image ? (
        <div className="diff-images">
          <ImageSide label={path.slice(path.lastIndexOf('/') + 1)} src={image} />
        </div>
      ) : (
        <Hunks hunks={[{ header: '', rows }]} tokens={tokens} />
      )}
    </div>
  )
}

const OPEN_FILE_LIMIT = 12

export function DiffView({ document }: { document: DiffDocument }) {
  const options = useDiffOptions()
  if (document.kind === 'patch') {
    return (
      <div className="diff-view">
        <Hunks hunks={patchHunks(document.text)} layout={options.layout} />
      </div>
    )
  }
  if (document.kind === 'file') {
    return <FileView path={document.path} text={document.text} image={document.image} />
  }
  return (
    <div className="diff-view">
      {document.files.map((file) => (
        <FileDiff
          key={`${document.title}\n${file.path}`}
          file={file}
          options={options}
          startOpen={
            document.focus ? file.path === document.focus : document.files.length <= OPEN_FILE_LIMIT
          }
        />
      ))}
      {document.files.length === 0 && <p className="diff-placeholder">This change has no files.</p>}
    </div>
  )
}
