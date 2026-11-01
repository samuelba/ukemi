import {
  RangeSetBuilder,
  StateField,
  type EditorState,
  type Extension,
  type Text,
} from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import {
  bothSidesEdit,
  parseConflicts,
  sideHeading,
  sideName,
  type ConflictBlock,
  type ConflictEdit,
  type ConflictLine,
  type ConflictSide,
} from '../../../shared/conflictMarkers'

const START_MARKER = '<<<<<<<'
// Sides past the fourth reuse the four side colors.
const SIDE_COLORS = 4

interface Conflicts {
  blocks: readonly ConflictBlock[]
  decorations: DecorationSet
}

// CodeMirror counts every line break as one position, as the parser does on `\n`-joined text,
// so block offsets are document positions even for a file with CRLF line endings.
function parse(doc: Text): ConflictBlock[] {
  const text = doc.toString()
  return text.includes(START_MARKER) ? parseConflicts(text) : []
}

// The color slot of a side, shared by its lines, its heading and its buttons.
export function sideColor(sideIndex: number): string {
  return `cm-conflict-side${(sideIndex % SIDE_COLORS) + 1}`
}

function swatch(sideIndex: number | null): HTMLElement {
  const dot = document.createElement('span')
  dot.className = `cm-conflict-swatch ${sideIndex === null ? 'cm-conflict-base' : sideColor(sideIndex)}`
  dot.setAttribute('aria-hidden', 'true')
  return dot
}

function lineClass(line: ConflictLine): string {
  const side = line.sideIndex === null ? '' : ` ${sideColor(line.sideIndex)}`
  if (line.kind === 'marker') {
    return line.sideIndex === null ? 'cm-conflict-marker' : `cm-conflict-header${side}`
  }
  return `cm-conflict-${line.kind}${side}`
}

function sidesKey(sides: readonly ConflictSide[]): string {
  return sides.map((side) => `${side.label}\0${side.diffFrom ?? ''}`).join('\0')
}

// The buttons above a conflict. Each side's button carries the side's color and name, so it
// matches the heading of the lines it keeps.
class AcceptWidget extends WidgetType {
  constructor(
    private readonly blockIndex: number,
    private readonly sides: readonly ConflictSide[],
  ) {
    super()
  }

  override eq(other: AcceptWidget): boolean {
    return other.blockIndex === this.blockIndex && sidesKey(other.sides) === sidesKey(this.sides)
  }

  toDOM(view: EditorView): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'cm-conflict-actions'
    const button = (sideIndex: number | null, label: string, title: string, run: () => void) => {
      const el = document.createElement('button')
      el.type = 'button'
      if (sideIndex !== null) {
        el.append(swatch(sideIndex))
      }
      el.append(label)
      el.title = title
      // Keeps the editor's selection; the click itself runs the action.
      el.addEventListener('mousedown', (event) => event.preventDefault())
      el.addEventListener('click', run)
      bar.append(el)
    }
    this.sides.forEach((side, sideIndex) =>
      button(
        sideIndex,
        `Accept ${sideName(side, sideIndex)}`,
        `Keep side ${sideIndex + 1}${side.label ? `: ${side.label}` : ''}`,
        () => acceptSide(view, this.blockIndex, sideIndex),
      ),
    )
    button(null, 'Accept all sides', 'Keep every side, one after the other', () =>
      acceptSide(view, this.blockIndex, 'both'),
    )
    return bar
  }

  override ignoreEvent(): boolean {
    return true
  }
}

// The name of a section, on its own row above its first header line, so a narrow pane shows it.
class HeadingWidget extends WidgetType {
  constructor(
    private readonly sideIndex: number | null,
    private readonly text: string,
  ) {
    super()
  }

  override eq(other: HeadingWidget): boolean {
    return other.sideIndex === this.sideIndex && other.text === this.text
  }

  toDOM(): HTMLElement {
    const row = document.createElement('div')
    row.className = `cm-conflict-heading ${this.sideIndex === null ? 'cm-conflict-base' : sideColor(this.sideIndex)}`
    row.append(swatch(this.sideIndex), this.text)
    return row
  }
}

// The first header line of each side and of the base, with its heading.
function headings(block: ConflictBlock): Map<number, HeadingWidget> {
  const found = new Map<number, HeadingWidget>()
  const named = new Set<number | null>()
  for (const line of block.lines) {
    // jj's fences belong to no side; git's opening fence is the only header of side 1.
    const isFence =
      line.sideIndex === null && (line.line === block.startLine || line.line === block.endLine)
    if (line.kind !== 'marker' || isFence || named.has(line.sideIndex)) {
      continue
    }
    named.add(line.sideIndex)
    const text =
      line.sideIndex === null ? 'base' : sideHeading(block.sides[line.sideIndex], line.sideIndex)
    found.set(line.line, new HeadingWidget(line.sideIndex, text))
  }
  return found
}

function decorate(state: EditorState, blocks: readonly ConflictBlock[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const block of blocks) {
    const first = state.doc.line(block.startLine + 1)
    builder.add(
      first.from,
      first.from,
      Decoration.widget({
        widget: new AcceptWidget(block.index, block.sides),
        block: true,
        side: -1,
      }),
    )
    const named = headings(block)
    for (const line of block.lines) {
      const docLine = state.doc.line(line.line + 1)
      const heading = named.get(line.line)
      // A block widget before a line sorts ahead of the line's own decoration.
      if (heading) {
        builder.add(
          docLine.from,
          docLine.from,
          Decoration.widget({ widget: heading, block: true, side: -1 }),
        )
      }
      builder.add(docLine.from, docLine.from, Decoration.line({ class: lineClass(line) }))
    }
  }
  return builder.finish()
}

function conflictsOf(state: EditorState): Conflicts {
  const blocks = parse(state.doc)
  return { blocks, decorations: decorate(state, blocks) }
}

export const conflictField = StateField.define<Conflicts>({
  create: conflictsOf,
  update: (value, tr) => (tr.docChanged ? conflictsOf(tr.state) : value),
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})

export function conflictBlocks(state: EditorState): readonly ConflictBlock[] {
  return state.field(conflictField, false)?.blocks ?? []
}

function apply(view: EditorView, edits: readonly ConflictEdit[]): void {
  if (edits.length === 0) {
    return
  }
  view.dispatch({
    changes: edits.map((edit) => ({ from: edit.start, to: edit.end, insert: edit.text })),
    userEvent: 'input.resolve',
  })
  view.focus()
}

export function acceptSide(view: EditorView, blockIndex: number, side: number | 'both'): void {
  const block = conflictBlocks(view.state)[blockIndex]
  if (!block) {
    return
  }
  if (side === 'both') {
    apply(view, [bothSidesEdit(block)])
    return
  }
  const chosen = block.sides[side]
  if (chosen) {
    apply(view, [{ start: block.start, end: block.end, text: chosen.text }])
  }
}

// Takes the side in every conflict that has it.
export function acceptSideEverywhere(view: EditorView, sideIndex: number): void {
  apply(
    view,
    conflictBlocks(view.state).flatMap((block) => {
      const side = block.sides[sideIndex]
      return side ? [{ start: block.start, end: block.end, text: side.text }] : []
    }),
  )
}

// The conflict the cursor is in, or the last one before it. -1 before the first conflict.
export function currentConflict(state: EditorState): number {
  const head = state.selection.main.head
  let current = -1
  for (const block of conflictBlocks(state)) {
    if (block.start <= head) {
      current = block.index
    }
  }
  return current
}

function goTo(view: EditorView, direction: 1 | -1): boolean {
  const blocks = conflictBlocks(view.state)
  if (blocks.length === 0) {
    return false
  }
  const head = view.state.selection.main.head
  const target =
    direction === 1
      ? (blocks.find((block) => block.start > head) ?? blocks[0])
      : ([...blocks].reverse().find((block) => block.start < head) ?? blocks[blocks.length - 1])
  if (!target) {
    return false
  }
  view.dispatch({
    selection: { anchor: target.start },
    effects: EditorView.scrollIntoView(target.start, { y: 'center' }),
  })
  view.focus()
  return true
}

export const nextConflict = (view: EditorView): boolean => goTo(view, 1)
export const previousConflict = (view: EditorView): boolean => goTo(view, -1)

export function conflictExtension(): Extension {
  return conflictField
}
