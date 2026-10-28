import * as vscode from 'vscode'
import {
  parseConflicts,
  sideName,
  type ConflictBlock,
  type ConflictLine,
} from '../conflict/markers'
import type { Handler } from './commands/context'
import { modelForFile } from './conflictLens'
import type { RepoRegistry } from './registry'

const SIDE_SLOTS = 4
const REFRESH_DELAY_MS = 150
const HAS_CONFLICTS_KEY = 'ukemi.editorHasConflicts'

interface SlotTypes {
  header: vscode.TextEditorDecorationType
  content: vscode.TextEditorDecorationType
}

interface DecorationSet {
  sides: SlotTypes[]
  base: SlotTypes
  fence: vscode.TextEditorDecorationType
  removed: vscode.TextEditorDecorationType
}

function color(id: string): vscode.ThemeColor {
  return new vscode.ThemeColor(id)
}

function slotTypes(name: string): SlotTypes {
  return {
    header: vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      fontWeight: 'bold',
      backgroundColor: color(`ukemi.conflict.${name}HeaderBackground`),
      overviewRulerColor: color(`ukemi.conflict.${name}HeaderBackground`),
      overviewRulerLane: vscode.OverviewRulerLane.Full,
    }),
    content: vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: color(`ukemi.conflict.${name}ContentBackground`),
      overviewRulerColor: color(`ukemi.conflict.${name}HeaderBackground`),
      overviewRulerLane: vscode.OverviewRulerLane.Full,
    }),
  }
}

function createTypes(): DecorationSet {
  return {
    sides: Array.from({ length: SIDE_SLOTS }, (_, i) => slotTypes(`side${i + 1}`)),
    base: slotTypes('base'),
    fence: vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      fontWeight: 'bold',
      backgroundColor: color('ukemi.conflict.markerBackground'),
      overviewRulerColor: color('ukemi.conflict.markerBackground'),
      overviewRulerLane: vscode.OverviewRulerLane.Full,
    }),
    removed: vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      textDecoration: 'line-through',
      opacity: '0.6',
      backgroundColor: color('ukemi.conflict.removedBackground'),
    }),
  }
}

function allTypes(types: DecorationSet): vscode.TextEditorDecorationType[] {
  return [
    ...types.sides.flatMap((slot) => [slot.header, slot.content]),
    types.base.header,
    types.base.content,
    types.fence,
    types.removed,
  ]
}

function roleName(block: ConflictBlock, line: ConflictLine): string {
  if (line.sideIndex === null) {
    return line.line === block.startLine ? `${block.sides.length}-sided conflict` : 'base'
  }
  return sideName(block.sides.length, line.sideIndex)
}

function headerOption(block: ConflictBlock, line: ConflictLine): vscode.DecorationOptions {
  return {
    range: new vscode.Range(line.line, 0, line.line, 0),
    renderOptions: {
      after: {
        contentText: `  ${roleName(block, line)}`,
        fontStyle: 'italic',
        color: color('editorCodeLens.foreground'),
      },
    },
  }
}

function lineRange(line: number): vscode.Range {
  return new vscode.Range(line, 0, line, 0)
}

function isLabelled(block: ConflictBlock, index: number): boolean {
  const line = block.lines[index]
  if (!line || line.line === block.endLine) {
    return false
  }
  const previous = block.lines[index - 1]
  return !previous || previous.kind !== 'marker' || previous.line === block.startLine
}

function buckets(types: DecorationSet, blocks: readonly ConflictBlock[]) {
  const map = new Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]>(
    allTypes(types).map((type) => [type, []]),
  )
  const push = (type: vscode.TextEditorDecorationType, option: vscode.DecorationOptions) =>
    map.get(type)?.push(option)

  for (const block of blocks) {
    block.lines.forEach((line, index) => {
      const slot = line.sideIndex === null ? types.base : types.sides[line.sideIndex % SIDE_SLOTS]
      if (!slot) {
        return
      }
      if (line.kind === 'marker') {
        const isFence = line.line === block.startLine || line.line === block.endLine
        const type = isFence && line.sideIndex === null ? types.fence : slot.header
        const option = isLabelled(block, index)
          ? headerOption(block, line)
          : { range: lineRange(line.line) }
        push(type, option)
        return
      }
      if (line.kind === 'removed') {
        push(types.removed, { range: lineRange(line.line) })
        return
      }
      push(line.kind === 'base' ? types.base.content : slot.content, {
        range: lineRange(line.line),
      })
    })
  }
  return map
}

export class ConflictDecorator implements vscode.Disposable {
  private readonly types = createTypes()
  private readonly blocks = new Map<string, ConflictBlock[]>()
  private readonly disposables: vscode.Disposable[] = []
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly registry: RepoRegistry) {
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshAll()),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateContext()),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (vscode.window.visibleTextEditors.some((e) => e.document === event.document)) {
          this.schedule()
        }
      }),
      registry.onDidChange(() => this.refreshAll()),
    )
    this.refreshAll()
  }

  commands(): Record<string, Handler> {
    return {
      'ukemi.conflict.next': () => this.move(1),
      'ukemi.conflict.previous': () => this.move(-1),
    }
  }

  private schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => {
      this.timer = null
      this.refreshAll()
    }, REFRESH_DELAY_MS)
  }

  private refreshAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.decorate(editor)
    }
    this.updateContext()
  }

  private blocksFor(document: vscode.TextDocument): ConflictBlock[] {
    if (document.uri.scheme !== 'file' || !modelForFile(this.registry, document.uri.fsPath)) {
      return []
    }
    const text = document.getText()
    return text.includes('<<<<<<<') ? parseConflicts(text) : []
  }

  private decorate(editor: vscode.TextEditor): void {
    const blocks = this.blocksFor(editor.document)
    this.blocks.set(editor.document.uri.toString(), blocks)
    for (const [type, options] of buckets(this.types, blocks)) {
      editor.setDecorations(type, options)
    }
  }

  private updateContext(): void {
    const editor = vscode.window.activeTextEditor
    const blocks = editor ? (this.blocks.get(editor.document.uri.toString()) ?? []) : []
    void vscode.commands.executeCommand('setContext', HAS_CONFLICTS_KEY, blocks.length > 0)
  }

  private move(step: 1 | -1): void {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      return
    }
    const blocks = this.blocksFor(editor.document)
    if (blocks.length === 0) {
      void vscode.window.showInformationMessage('Ukemi: no conflicts in this file.')
      return
    }
    const line = editor.selection.active.line
    const target =
      step === 1
        ? (blocks.find((block) => block.startLine > line) ?? blocks[0])
        : ([...blocks].reverse().find((block) => block.endLine < line) ?? blocks[blocks.length - 1])
    if (!target) {
      return
    }
    const position = new vscode.Position(target.startLine, 0)
    editor.selection = new vscode.Selection(position, position)
    editor.revealRange(
      new vscode.Range(target.startLine, 0, target.endLine, 0),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    )
    vscode.window.setStatusBarMessage(
      `Ukemi: conflict ${target.index + 1} of ${blocks.length}`,
      2_000,
    )
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.disposables.forEach((d) => d.dispose())
    allTypes(this.types).forEach((type) => type.dispose())
  }
}
