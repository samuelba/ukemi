const MARKER_MIN_LENGTH = 7
const NO_TERMINATING_NEWLINE = '(no terminating newline)'

export interface ConflictSide {
  label: string
  text: string
}

export type ConflictLineKind = 'marker' | 'side' | 'base' | 'added' | 'removed'

export interface ConflictLine {
  line: number
  kind: ConflictLineKind
  sideIndex: number | null
}

export interface ConflictBlock {
  index: number
  startLine: number
  endLine: number
  start: number
  end: number
  sides: ConflictSide[]
  lines: ConflictLine[]
}

export type ConflictChoice =
  { readonly conflictIndex: number; readonly sideIndex: number } | { readonly sideIndex: number }

export interface ConflictEdit {
  start: number
  end: number
  text: string
}

interface RawLine {
  text: string
  start: number
  end: number
  line: number
}

interface Section {
  kind: 'diff' | 'snapshot' | 'base'
  label: string
  fromLabel: string
  lines: string[]
  headerLines: number[]
  contentLines: number[]
}

interface Parsed {
  next: number
  block: Omit<ConflictBlock, 'index'>
}

type Header =
  | { kind: 'none' }
  | { kind: 'broken' }
  | { kind: 'end'; line: RawLine }
  | { kind: 'section'; section: Section; next: number }

export function sideName(sideCount: number, sideIndex: number): string {
  if (sideCount === 2 && sideIndex === 0) {
    return 'current'
  }
  if (sideCount === 2 && sideIndex === 1) {
    return 'incoming'
  }
  return `side ${sideIndex + 1}`
}

export function conflictAtLine(
  blocks: readonly ConflictBlock[],
  line: number,
): ConflictBlock | undefined {
  return blocks.find((block) => line >= block.startLine && line <= block.endLine)
}

export function parseConflicts(text: string): ConflictBlock[] {
  const rows = linesOf(text)
  const blocks: ConflictBlock[] = []
  let index = 0
  while (index < rows.length) {
    const parsed = tryParse(rows, index)
    if (parsed) {
      blocks.push({ ...parsed.block, index: blocks.length })
      index = parsed.next
      continue
    }
    index += 1
  }
  return blocks
}

export function conflictEdits(text: string, choice: ConflictChoice): ConflictEdit[] {
  const blocks = parseConflicts(text)
  if ('conflictIndex' in choice) {
    return [oneEdit(blocks, choice.conflictIndex, choice.sideIndex)]
  }
  return blocks.flatMap((block) => {
    const side = block.sides[choice.sideIndex]
    return side ? [editFor(block, side.text)] : []
  })
}

export function applyConflicts(text: string, choice: ConflictChoice): string {
  let cursor = 0
  let out = ''
  for (const edit of conflictEdits(text, choice)) {
    out += text.slice(cursor, edit.start) + edit.text
    cursor = edit.end
  }
  return out + text.slice(cursor)
}

function oneEdit(
  blocks: readonly ConflictBlock[],
  conflictIndex: number,
  sideIndex: number,
): ConflictEdit {
  const block = blocks[conflictIndex]
  if (!block) {
    throw new Error(`Conflict ${conflictIndex + 1} is not in this file.`)
  }
  const side = block.sides[sideIndex]
  if (!side) {
    throw new Error(`Conflict ${conflictIndex + 1} has no side ${sideIndex + 1}.`)
  }
  return editFor(block, side.text)
}

function editFor(block: ConflictBlock, text: string): ConflictEdit {
  return { start: block.start, end: block.end, text }
}

function linesOf(text: string): RawLine[] {
  const lines: RawLine[] = []
  let start = 0
  let line = 0
  while (start < text.length) {
    const newline = text.indexOf('\n', start)
    const end = newline === -1 ? text.length : newline + 1
    lines.push({ text: text.slice(start, end), start, end, line })
    line += 1
    start = end
  }
  return lines
}

function tryParse(rows: readonly RawLine[], index: number): Parsed | null {
  const start = marker(rows[index]?.text ?? '', '<')
  if (!start) {
    return null
  }
  return isJjStart(start.label)
    ? parseJj(rows, index, start.length)
    : parseGit(rows, index, start.length)
}

function parseJj(rows: readonly RawLine[], at: number, run: number): Parsed | null {
  const sections: Section[] = []
  let index = at + 1
  while (index < rows.length) {
    const header = classify(rows, index, run)
    if (header.kind === 'broken') {
      return null
    }
    if (header.kind === 'end') {
      return finishJj(rows[at], header.line, sections, index + 1)
    }
    if (header.kind === 'section') {
      sections.push(header.section)
      index = header.next
      continue
    }
    const section = sections[sections.length - 1]
    const line = rows[index]
    if (!section || !line) {
      return null
    }
    sections[sections.length - 1] = {
      ...section,
      lines: [...section.lines, line.text],
      contentLines: [...section.contentLines, line.line],
    }
    index += 1
  }
  return null
}

function classify(rows: readonly RawLine[], index: number, run: number): Header {
  const row = rows[index]
  if (!row) {
    return { kind: 'broken' }
  }
  const end = marker(row.text, '>')
  if (end && end.length === run) {
    return isJjEnd(end.label) ? { kind: 'end', line: row } : { kind: 'none' }
  }
  const diff = diffHeader(rows, index, run)
  if (diff) {
    return diff
  }
  const plus = marker(row.text, '+')
  if (plus && plus.length === run) {
    return { kind: 'section', next: index + 1, section: section('snapshot', plus.label, row) }
  }
  const base = marker(row.text, '-')
  if (base && base.length === run) {
    return { kind: 'section', next: index + 1, section: section('base', base.label, row) }
  }
  return { kind: 'none' }
}

function diffHeader(rows: readonly RawLine[], index: number, run: number): Header | null {
  const row = rows[index]
  const percent = row ? marker(row.text, '%') : null
  if (!percent || percent.length !== run) {
    return null
  }
  const toRow = rows[index + 1]
  const slash = toRow ? marker(toRow.text, '\\') : null
  if (!row || !toRow || !slash || slash.length !== run) {
    return { kind: 'broken' }
  }
  return {
    kind: 'section',
    next: index + 2,
    section: {
      kind: 'diff',
      fromLabel: stripPrefix(percent.label, 'diff from:'),
      label: stripPrefix(slash.label, 'to:'),
      lines: [],
      headerLines: [row.line, toRow.line],
      contentLines: [],
    },
  }
}

function finishJj(
  start: RawLine | undefined,
  end: RawLine,
  sections: readonly Section[],
  next: number,
): Parsed | null {
  if (!start || sections.length === 0) {
    return null
  }
  const mixed = sections.some(sectionMissesNewline)
  const sides = sections.flatMap((section) =>
    section.kind === 'base'
      ? []
      : [{ label: displayLabel(section.label), text: sideText(section, mixed) }],
  )
  if (sides.length === 0) {
    return null
  }
  return {
    next,
    block: {
      startLine: start.line,
      endLine: end.line,
      start: start.start,
      end: end.end,
      sides,
      lines: jjLines(start, end, sections),
    },
  }
}

function jjLines(start: RawLine, end: RawLine, sections: readonly Section[]): ConflictLine[] {
  let nextSide = 0
  const body = sections.flatMap((section) => {
    const sideIndex = section.kind === 'base' ? null : nextSide++
    const headers = section.headerLines.map((line) => ({
      line,
      kind: 'marker' as const,
      sideIndex,
    }))
    const content = section.contentLines.map((line, i) => ({
      line,
      kind: contentKind(section, section.lines[i] ?? ''),
      sideIndex,
    }))
    return [...headers, ...content]
  })
  return [
    { line: start.line, kind: 'marker', sideIndex: null },
    ...body,
    { line: end.line, kind: 'marker', sideIndex: null },
  ]
}

function contentKind(section: Section, text: string): ConflictLineKind {
  if (section.kind === 'base') {
    return 'base'
  }
  if (section.kind === 'snapshot') {
    return 'side'
  }
  if (text.startsWith('+')) {
    return 'added'
  }
  return text.startsWith('-') ? 'removed' : 'side'
}

function parseGit(rows: readonly RawLine[], at: number, run: number): Parsed | null {
  const opening = rows[at]
  const start = opening ? marker(opening.text, '<') : null
  if (!opening || !start) {
    return null
  }
  const current: string[] = []
  const incoming: string[] = []
  const lines: ConflictLine[] = [{ line: opening.line, kind: 'marker', sideIndex: 0 }]
  let phase: 'current' | 'base' | 'incoming' = 'current'
  for (let index = at + 1; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row) {
      return null
    }
    const nested = marker(row.text, '<')
    if (nested && nested.length >= run) {
      return null
    }
    const end = marker(row.text, '>')
    if (end && end.length === run) {
      if (phase !== 'incoming') {
        return null
      }
      const block = {
        startLine: opening.line,
        endLine: row.line,
        start: opening.start,
        end: row.end,
        sides: [
          { label: start.label, text: current.join('') },
          { label: end.label, text: incoming.join('') },
        ],
        lines: [...lines, { line: row.line, kind: 'marker' as const, sideIndex: 1 }],
      }
      return { next: index + 1, block }
    }
    const divider = marker(row.text, '=')
    if (divider && divider.length === run && phase !== 'incoming') {
      phase = 'incoming'
      lines.push({ line: row.line, kind: 'marker', sideIndex: 1 })
      continue
    }
    const base = marker(row.text, '|')
    if (base && base.length === run && phase === 'current') {
      phase = 'base'
      lines.push({ line: row.line, kind: 'marker', sideIndex: null })
      continue
    }
    if (phase === 'current') {
      current.push(row.text)
      lines.push({ line: row.line, kind: 'side', sideIndex: 0 })
    } else if (phase === 'incoming') {
      incoming.push(row.text)
      lines.push({ line: row.line, kind: 'side', sideIndex: 1 })
    } else {
      lines.push({ line: row.line, kind: 'base', sideIndex: null })
    }
  }
  return null
}

function section(kind: 'snapshot' | 'base', label: string, row: RawLine): Section {
  return { kind, label, fromLabel: '', lines: [], headerLines: [row.line], contentLines: [] }
}

function sideText(section: Section, mixed: boolean): string {
  const lines = section.kind === 'diff' ? applyDiff(section.lines) : section.lines
  return joinSublines(lines, hasNoEol(section.label), mixed)
}

function applyDiff(lines: readonly string[]): string[] {
  return lines.flatMap((line) => {
    const prefix = line[0]
    if (prefix !== '+' && prefix !== ' ') {
      return []
    }
    return [line.slice(1)]
  })
}

function joinSublines(lines: readonly string[], noEol: boolean, mixed: boolean): string {
  let content = lines.join('')
  if (!noEol && !mixed) {
    return content
  }
  if (content.endsWith('\r\n')) {
    content = content.slice(0, -2)
  } else if (content.endsWith('\n')) {
    content = content.slice(0, -1)
  }
  return content
}

function sectionMissesNewline(section: Section): boolean {
  return hasNoEol(section.label) || hasNoEol(section.fromLabel)
}

function hasNoEol(label: string): boolean {
  return label.trimEnd().endsWith(NO_TERMINATING_NEWLINE)
}

function displayLabel(label: string): string {
  const trimmed = label.trim()
  if (!hasNoEol(trimmed)) {
    return trimmed
  }
  return trimmed.slice(0, -NO_TERMINATING_NEWLINE.length).trim()
}

function stripPrefix(label: string, prefix: string): string {
  return label.startsWith(prefix) ? label.slice(prefix.length).trim() : label.trim()
}

function isJjStart(label: string): boolean {
  return /^conflict \d+ of \d+$/.test(label)
}

function isJjEnd(label: string): boolean {
  return isJjStart(label) || /^conflict \d+ of \d+ ends$/.test(label)
}

function marker(line: string, char: string): { length: number; label: string } | null {
  const body = stripEnding(line)
  let length = 0
  while (length < body.length && body[length] === char) {
    length += 1
  }
  if (length < MARKER_MIN_LENGTH) {
    return null
  }
  const rest = body.slice(length)
  if (rest.length > 0 && !rest.startsWith(' ')) {
    return null
  }
  return { length, label: rest.trim() }
}

function stripEnding(line: string): string {
  if (line.endsWith('\r\n')) {
    return line.slice(0, -2)
  }
  if (line.endsWith('\n')) {
    return line.slice(0, -1)
  }
  return line
}
