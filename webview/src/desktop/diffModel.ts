import { diffWords, diffWordsWithSpace, structuredPatch } from 'diff'
import type { Token } from '../editor/syntaxClasses'

export interface DiffPart {
  text: string
  changed: boolean
}

export interface DiffRow {
  kind: 'same' | 'removed' | 'added' | 'note'
  text: string
  oldLine: number | null
  newLine: number | null
  // Word-level marks, only on a changed line paired with its counterpart.
  parts?: DiffPart[]
  // The old side's text of an unchanged line, when whitespace is ignored and it differs.
  oldText?: string
}

// One row of the side-by-side view. A missing side is padding across from a longer run.
export interface SplitRow {
  left: DiffRow | null
  right: DiffRow | null
}

export interface DiffHunkOptions {
  ignoreWhitespace?: boolean
}

// A run of a line with one syntax class and one word mark.
export interface DiffSegment {
  text: string
  cls?: string
  changed: boolean
}

export interface DiffHunk {
  header: string
  rows: DiffRow[]
}

const CONTEXT_LINES = 3
// Word marks on very long lines cost a lot and help little.
const MAX_WORD_DIFF_LENGTH = 1_000

function markWords(removed: DiffRow[], added: DiffRow[], ignoreWhitespace: boolean): void {
  const pairs = Math.min(removed.length, added.length)
  for (let i = 0; i < pairs; i++) {
    const left = removed[i]
    const right = added[i]
    if (
      !left ||
      !right ||
      left.text.length > MAX_WORD_DIFF_LENGTH ||
      right.text.length > MAX_WORD_DIFF_LENGTH
    ) {
      continue
    }
    const changes = ignoreWhitespace
      ? diffWords(left.text, right.text)
      : diffWordsWithSpace(left.text, right.text)
    left.parts = changes
      .filter((change) => !change.added)
      .map((change) => ({ text: change.value, changed: Boolean(change.removed) }))
    right.parts = changes
      .filter((change) => !change.removed)
      .map((change) => ({ text: change.value, changed: Boolean(change.added) }))
  }
}

// Calls back with each run of removed lines and the added run after it, as a reviewer reads
// them, or with a lone row that is neither.
function eachRun(
  rows: readonly DiffRow[],
  onRun: (removed: DiffRow[], added: DiffRow[]) => void,
  onOther: (row: DiffRow) => void,
): void {
  let i = 0
  while (i < rows.length) {
    const removed: DiffRow[] = []
    while (rows[i]?.kind === 'removed') {
      removed.push(rows[i] as DiffRow)
      i++
    }
    const added: DiffRow[] = []
    while (rows[i]?.kind === 'added') {
      added.push(rows[i] as DiffRow)
      i++
    }
    if (removed.length > 0 || added.length > 0) {
      onRun(removed, added)
    } else {
      onOther(rows[i] as DiffRow)
      i++
    }
  }
}

function withWordMarks(rows: DiffRow[], ignoreWhitespace = false): DiffRow[] {
  eachRun(
    rows,
    (removed, added) => {
      if (removed.length > 0 && added.length > 0) {
        markWords(removed, added, ignoreWhitespace)
      }
    },
    () => {},
  )
  return rows
}

// Lines up the rows in two columns. A removed run sits across from the added run after it,
// paired as their word marks are, and the shorter run is padded.
export function splitRows(rows: readonly DiffRow[]): SplitRow[] {
  const result: SplitRow[] = []
  eachRun(
    rows,
    (removed, added) => {
      for (let i = 0; i < Math.max(removed.length, added.length); i++) {
        result.push({ left: removed[i] ?? null, right: added[i] ?? null })
      }
    },
    (row) => result.push({ left: row, right: row }),
  )
  return result
}

function hunkRows(
  lines: readonly string[],
  oldStart: number,
  newStart: number,
  ignoreWhitespace = false,
): DiffRow[] {
  let oldLine = oldStart
  let newLine = newStart
  const rows: DiffRow[] = []
  for (const line of lines) {
    const marker = line[0]
    const text = line.slice(1)
    if (marker === '-') {
      rows.push({ kind: 'removed', text, oldLine: oldLine++, newLine: null })
    } else if (marker === '+') {
      rows.push({ kind: 'added', text, oldLine: null, newLine: newLine++ })
    } else if (marker === ' ') {
      rows.push({ kind: 'same', text, oldLine: oldLine++, newLine: newLine++ })
    }
  }
  return withWordMarks(rows, ignoreWhitespace)
}

// The hunks between two versions of a file. A missing side is an added or removed file.
// Above these, diffing and rendering every line freezes the window for seconds, as with a lock
// file or a minified bundle, so the view waits until it is asked.
export const LARGE_DIFF_LINES = 5_000
const LARGE_DIFF_CHARACTERS = 1_000_000

export function isLargeDiff(left: string | null, right: string | null): boolean {
  return [left, right].some(
    (text) =>
      text !== null && (text.length > LARGE_DIFF_CHARACTERS || lineCount(text) > LARGE_DIFF_LINES),
  )
}

function lineCount(text: string): number {
  let count = 0
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    count += 1
  }
  return count
}

// Like `git diff -b`, but also blind to indentation: a re-indented or re-aligned line is the
// same line, while `a b` and `ab` still differ.
function sameIgnoringWhitespace(left: string, right: string): boolean {
  return left.trim().replace(/\s+/g, ' ') === right.trim().replace(/\s+/g, ' ')
}

export function diffHunks(
  left: string | null,
  right: string | null,
  options: DiffHunkOptions = {},
): DiffHunk[] {
  const ignoreWhitespace = options.ignoreWhitespace ?? false
  const patch = structuredPatch('a', 'b', left ?? '', right ?? '', '', '', {
    context: CONTEXT_LINES,
    ...(ignoreWhitespace ? { comparator: sameIgnoringWhitespace } : {}),
  })
  // The text of an unchanged line comes from the new side, so keep the old one for its column.
  const oldLines = ignoreWhitespace ? (left ?? '').split('\n') : null
  return patch.hunks.map((hunk) => {
    const rows = hunkRows(hunk.lines, hunk.oldStart, hunk.newStart, ignoreWhitespace)
    for (const row of oldLines ? rows : []) {
      const oldText =
        row.kind === 'same' && row.oldLine !== null ? oldLines?.[row.oldLine - 1] : undefined
      if (oldText !== undefined && oldText !== row.text) {
        row.oldText = oldText
      }
    }
    return {
      header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      rows,
    }
  })
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

// The hunks of a unified patch, like jj's interdiff. Text outside hunks stays as notes.
export function patchHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let current: { header: string; lines: string[]; oldStart: number; newStart: number } | null = null
  let notes: string[] = []
  const flushNotes = () => {
    if (notes.length > 0) {
      hunks.push({
        header: '',
        rows: notes.map((text) => ({ kind: 'note', text, oldLine: null, newLine: null })),
      })
      notes = []
    }
  }
  const flushHunk = () => {
    if (current) {
      hunks.push({
        header: current.header,
        rows: hunkRows(current.lines, current.oldStart, current.newStart),
      })
      current = null
    }
  }
  for (const line of patch.replace(/\n$/, '').split('\n')) {
    const header = HUNK_HEADER.exec(line)
    if (header) {
      flushHunk()
      flushNotes()
      current = {
        header: line,
        lines: [],
        oldStart: Number(header[1]),
        newStart: Number(header[2]),
      }
      continue
    }
    if (current && /^[ +-]/.test(line)) {
      current.lines.push(line)
      continue
    }
    flushHunk()
    if (!/^(diff --git|--- |\+\+\+ |index )/.test(line)) {
      notes.push(line)
    }
  }
  flushHunk()
  flushNotes()
  return hunks
}

// Cuts a line at both its syntax tokens and its word marks, so each run has one of each.
export function segments(
  text: string,
  tokens: readonly Token[] | undefined,
  parts: readonly DiffPart[] | undefined,
): DiffSegment[] {
  const marks = parts ?? [{ text, changed: false }]
  const cuts = new Set([0, text.length])
  let offset = 0
  const ranges = marks.map((part) => {
    const range = { from: offset, to: offset + part.text.length, changed: part.changed }
    offset = range.to
    cuts.add(range.to)
    return range
  })
  for (const token of tokens ?? []) {
    cuts.add(Math.min(token.from, text.length))
    cuts.add(Math.min(token.to, text.length))
  }
  const points = [...cuts].sort((a, b) => a - b)
  const result: DiffSegment[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i] as number
    const to = points[i + 1] as number
    const token = tokens?.find((item) => item.from <= from && to <= item.to)
    const changed = ranges.some((range) => range.changed && range.from <= from && to <= range.to)
    const previous = result[result.length - 1]
    if (previous && previous.cls === token?.cls && previous.changed === changed) {
      previous.text += text.slice(from, to)
    } else {
      result.push({ text: text.slice(from, to), cls: token?.cls, changed })
    }
  }
  return result
}

// An SVG file shows as an image through a data URL of its text.
export function svgDataUrl(text: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
}

// The size of the file a data URL holds.
export function dataUrlBytes(url: string): number {
  const comma = url.indexOf(',')
  const data = url.slice(comma + 1)
  if (!url.slice(0, comma).endsWith(';base64')) {
    return new TextEncoder().encode(decodeURIComponent(data)).length
  }
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return (data.length / 4) * 3 - padding
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const kb = bytes / 1024
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`
}
