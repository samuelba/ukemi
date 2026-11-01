import { diffWordsWithSpace, structuredPatch } from 'diff'
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

function markWords(removed: DiffRow[], added: DiffRow[]): void {
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
    const changes = diffWordsWithSpace(left.text, right.text)
    left.parts = changes
      .filter((change) => !change.added)
      .map((change) => ({ text: change.value, changed: Boolean(change.removed) }))
    right.parts = changes
      .filter((change) => !change.removed)
      .map((change) => ({ text: change.value, changed: Boolean(change.added) }))
  }
}

// Pairs each run of removed lines with the added run after it, as a reviewer reads them.
function withWordMarks(rows: DiffRow[]): DiffRow[] {
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
    if (removed.length > 0 && added.length > 0) {
      markWords(removed, added)
    }
    if (removed.length === 0 && added.length === 0) {
      i++
    }
  }
  return rows
}

function hunkRows(lines: readonly string[], oldStart: number, newStart: number): DiffRow[] {
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
  return withWordMarks(rows)
}

// The hunks between two versions of a file. A missing side is an added or removed file.
export function diffHunks(left: string | null, right: string | null): DiffHunk[] {
  const patch = structuredPatch('a', 'b', left ?? '', right ?? '', '', '', {
    context: CONTEXT_LINES,
  })
  return patch.hunks.map((hunk) => ({
    header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    rows: hunkRows(hunk.lines, hunk.oldStart, hunk.newStart),
  }))
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
