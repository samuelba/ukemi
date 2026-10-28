import { isAbsolute, relative, sep } from 'node:path'
import * as vscode from 'vscode'
import { z } from 'zod'
import {
  conflictAtLine,
  conflictEdits,
  parseConflicts,
  sideName,
  type ConflictBlock,
  type ConflictChoice,
  type ConflictEdit,
  type ConflictSide,
} from '../conflict/markers'
import type { RepoModel } from '../repo/repoModel'
import { errorMessage } from '../util/logger'
import type { CommandEnv, Handler } from './commands/context'
import type { RepoRegistry } from './registry'

const commandArgs = z.object({
  uri: z.string().optional(),
  sideIndex: z.number().int().nonnegative().optional(),
  conflictIndex: z.number().int().nonnegative().optional(),
})

type CommandArgs = z.infer<typeof commandArgs>

interface LensArgs {
  uri: string
  sideIndex: number
  conflictIndex?: number
}

interface SidePick extends vscode.QuickPickItem {
  sideIndex: number
}

export function conflictCommands(env: CommandEnv): Record<string, Handler> {
  return {
    'ukemi.conflict.accept': (arg?: unknown) => accept(env, arg, false),
    'ukemi.conflict.acceptAll': (arg?: unknown) => accept(env, arg, true),
  }
}

export function registerConflictLenses(registry: RepoRegistry): vscode.Disposable {
  const changes = new vscode.EventEmitter<void>()
  const provider: vscode.CodeLensProvider = {
    onDidChangeCodeLenses: changes.event,
    provideCodeLenses(document) {
      return provide(registry, document)
    },
  }
  return vscode.Disposable.from(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, provider),
    registry.onDidChange(() => changes.fire()),
    changes,
  )
}

function provide(registry: RepoRegistry, document: vscode.TextDocument): vscode.CodeLens[] {
  if (document.uri.scheme !== 'file') {
    return []
  }
  const text = document.getText()
  if (!text.includes('<<<<<<<') || !modelForFile(registry, document.uri.fsPath)) {
    return []
  }
  const blocks = parseConflicts(text)
  return blocks.length === 0 ? [] : lensesFor(document, blocks)
}

function lensesFor(
  document: vscode.TextDocument,
  blocks: readonly ConflictBlock[],
): vscode.CodeLens[] {
  const uri = document.uri.toString()
  const count = sharedSideCount(blocks)
  const fileLenses = Array.from({ length: count }, (_, sideIndex) =>
    codeLens(
      0,
      `Accept all ${fileSideTitle(blocks, sideIndex)}`,
      fileSideLabel(blocks, sideIndex),
      'ukemi.conflict.acceptAll',
      { uri, sideIndex },
    ),
  )
  const blockLenses = blocks.flatMap((block) =>
    block.sides.map((side, sideIndex) =>
      codeLens(
        block.startLine,
        `Accept ${sideName(block.sides.length, sideIndex)}`,
        side.label,
        'ukemi.conflict.accept',
        { uri, sideIndex, conflictIndex: block.index },
      ),
    ),
  )
  return [...fileLenses, ...blockLenses]
}

function codeLens(
  line: number,
  title: string,
  tooltip: string,
  command: string,
  args: LensArgs,
): vscode.CodeLens {
  return new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
    title,
    tooltip: tooltip || title,
    command,
    arguments: [args],
  })
}

async function accept(env: CommandEnv, arg: unknown, all: boolean): Promise<void> {
  const args = readArgs(arg)
  const target = await targetDocument(env.registry, args.uri)
  if (!target) {
    return
  }
  const blocks = parseConflicts(target.document.getText())
  if (blocks.length === 0) {
    void vscode.window.showWarningMessage('Ukemi: this file has no conflict markers.')
    return
  }
  const choice = await choiceFor(args, blocks, target.document, all)
  if (!choice) {
    return
  }
  await writeChoice(env, target.model, target.document, choice)
}

async function choiceFor(
  args: CommandArgs,
  blocks: readonly ConflictBlock[],
  document: vscode.TextDocument,
  all: boolean,
): Promise<ConflictChoice | undefined> {
  if (args.sideIndex === undefined) {
    return pickSide(blocks, document, all)
  }
  if (all) {
    return { sideIndex: args.sideIndex }
  }
  const conflictIndex = args.conflictIndex ?? conflictAtLine(blocks, cursorLine(document))?.index
  if (conflictIndex === undefined) {
    void vscode.window.showWarningMessage('Ukemi: the cursor is not in a conflict.')
    return undefined
  }
  return { conflictIndex, sideIndex: args.sideIndex }
}

async function pickSide(
  blocks: readonly ConflictBlock[],
  document: vscode.TextDocument,
  all: boolean,
): Promise<ConflictChoice | undefined> {
  if (all) {
    return pickFileSide(blocks)
  }
  const block = conflictAtLine(blocks, cursorLine(document))
  if (!block) {
    void vscode.window.showWarningMessage('Ukemi: the cursor is not in a conflict.')
    return undefined
  }
  const pick = await vscode.window.showQuickPick(sidePicks(block.sides), {
    title: 'Accept this conflict',
  })
  return pick ? { conflictIndex: block.index, sideIndex: pick.sideIndex } : undefined
}

async function pickFileSide(blocks: readonly ConflictBlock[]): Promise<ConflictChoice | undefined> {
  const count = sharedSideCount(blocks)
  const pick = await vscode.window.showQuickPick(
    Array.from({ length: count }, (_, sideIndex) => ({
      label: `Accept all ${fileSideTitle(blocks, sideIndex)}`,
      description: fileSideLabel(blocks, sideIndex) || undefined,
      sideIndex,
    })),
    { title: 'Accept all conflicts in this file' },
  )
  return pick ? { sideIndex: pick.sideIndex } : undefined
}

function sidePicks(sides: readonly ConflictSide[]): SidePick[] {
  return sides.map((side, sideIndex) => ({
    label: `Accept ${sideName(sides.length, sideIndex)}`,
    description: side.label || undefined,
    sideIndex,
  }))
}

async function writeChoice(
  env: CommandEnv,
  model: RepoModel,
  document: vscode.TextDocument,
  choice: ConflictChoice,
): Promise<void> {
  const text = document.getText()
  const edits = editsFor(text, choice)
  if (!edits) {
    return
  }
  if (edits.length === 0) {
    void vscode.window.showWarningMessage('Ukemi: that side is not in this file.')
    return
  }
  const workspace = new vscode.WorkspaceEdit()
  for (const edit of [...edits].reverse()) {
    workspace.replace(
      document.uri,
      new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)),
      edit.text,
    )
  }
  if (!(await vscode.workspace.applyEdit(workspace))) {
    void vscode.window.showErrorMessage('Ukemi: could not edit the file.')
    return
  }
  if (!(await document.save())) {
    void vscode.window.showWarningMessage(
      'Ukemi: the file was not saved, so jj still has the conflict.',
    )
    return
  }
  await env.operations.run('Resolve', model, () => model.repo.snapshot())
}

function editsFor(text: string, choice: ConflictChoice): ConflictEdit[] | undefined {
  try {
    return conflictEdits(text, choice)
  } catch (error: unknown) {
    void vscode.window.showErrorMessage(`Ukemi: ${errorMessage(error)}`)
    return undefined
  }
}

async function targetDocument(
  registry: RepoRegistry,
  uriText: string | undefined,
): Promise<{ document: vscode.TextDocument; model: RepoModel } | undefined> {
  const document = await openDocument(uriText)
  if (!document) {
    void vscode.window.showWarningMessage('Ukemi: open a conflicted file first.')
    return undefined
  }
  if (document.uri.scheme !== 'file') {
    void vscode.window.showWarningMessage('Ukemi: conflict buttons only edit a working-copy file.')
    return undefined
  }
  const model = modelForFile(registry, document.uri.fsPath)
  if (!model) {
    void vscode.window.showWarningMessage('Ukemi: this file is not in a jj repository.')
    return undefined
  }
  return { document, model }
}

async function openDocument(uriText: string | undefined): Promise<vscode.TextDocument | undefined> {
  if (!uriText) {
    return vscode.window.activeTextEditor?.document
  }
  const uri = vscode.Uri.parse(uriText)
  const open = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString())
  return open ?? vscode.workspace.openTextDocument(uri)
}

export function modelForFile(registry: RepoRegistry, fsPath: string): RepoModel | null {
  const matches = registry.models.filter((model) => insideRoot(model.root, fsPath))
  return matches.sort((left, right) => right.root.length - left.root.length)[0] ?? null
}

function insideRoot(root: string, fsPath: string): boolean {
  const rel = relative(root, fsPath)
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)
}

function cursorLine(document: vscode.TextDocument): number {
  const editor = vscode.window.activeTextEditor
  if (editor?.document.uri.toString() === document.uri.toString()) {
    return editor.selection.active.line
  }
  return 0
}

function fileSideTitle(blocks: readonly ConflictBlock[], sideIndex: number): string {
  if (blocks.every((block) => block.sides.length === 2)) {
    return sideName(2, sideIndex)
  }
  return sideName(Math.max(sharedSideCount(blocks), 3), sideIndex)
}

function sharedSideCount(blocks: readonly ConflictBlock[]): number {
  return blocks.reduce(
    (count, block) => Math.min(count, block.sides.length),
    Number.POSITIVE_INFINITY,
  )
}

function fileSideLabel(blocks: readonly ConflictBlock[], sideIndex: number): string {
  const labels = [...new Set(blocks.map((block) => block.sides[sideIndex]?.label ?? ''))]
  return labels.length === 1 ? (labels[0] ?? '') : ''
}

function readArgs(arg: unknown): CommandArgs {
  const parsed = commandArgs.safeParse(arg ?? {})
  return parsed.success ? parsed.data : {}
}
