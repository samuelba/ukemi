import { basename, join } from 'node:path'
import * as vscode from 'vscode'
import { z } from 'zod'
import type { ChangedFile, EvolutionEntry } from '../../shared/model'
import type { CommitView } from '../../shared/protocol'
import type { RepoRegistry } from '../app/registry'
import {
  changeLabel,
  commitDiffEntries,
  commitDiffTitle,
  fileAtRevision,
  fileDiffSides,
  interdiffText,
  revisionText,
  versionDiffEntries,
  versionDiffTitle,
  type DiffEntry,
  type FileSide,
} from '../app/revisionContent'
import type { RepoModel } from '../repo/repoModel'

export const DIFF_SCHEME = 'ukemi'
export const INTERDIFF_SCHEME = 'ukemi-interdiff'

interface DiffQuery {
  root: string
  commitId: string
  path: string
}

export function revisionUri(root: string, commitId: string, path: string): vscode.Uri {
  const query: DiffQuery = { root, commitId, path }
  return vscode.Uri.file(join(root, path)).with({
    scheme: DIFF_SCHEME,
    query: JSON.stringify(query),
  })
}

function sideUri(root: string, side: FileSide): vscode.Uri {
  return side.kind === 'disk'
    ? vscode.Uri.file(join(root, side.path))
    : revisionUri(root, side.commitId, side.path)
}

const diffQuerySchema = z.object({ root: z.string(), commitId: z.string(), path: z.string() })

function parseQuery(uri: vscode.Uri): DiffQuery | null {
  try {
    const result = diffQuerySchema.safeParse(JSON.parse(uri.query))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export class RevisionContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly registry: RepoRegistry) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const query = parseQuery(uri)
    const model = query ? this.registry.modelFor(query.root) : null
    if (!query || !model) {
      return ''
    }
    return revisionText(model, query.commitId, query.path)
  }
}

function changesResources(root: string, entries: readonly DiffEntry[]) {
  return entries.map((entry) => [
    vscode.Uri.file(join(root, entry.path)),
    entry.left ? sideUri(root, entry.left) : undefined,
    entry.right ? sideUri(root, entry.right) : undefined,
  ])
}

export async function openFileDiff(model: RepoModel, commit: CommitView, file: ChangedFile) {
  const { left, right } = fileDiffSides(commit, file)
  const rightUri = sideUri(model.root, right)
  const title = `${basename(file.path)} (${changeLabel(commit)})`
  if (!left || file.status === 'added') {
    await vscode.commands.executeCommand('vscode.open', rightUri, { preview: true })
    return
  }
  await vscode.commands.executeCommand('vscode.diff', sideUri(model.root, left), rightUri, title, {
    preview: true,
  })
}

export async function openCommitDiff(model: RepoModel, commit: CommitView, files: ChangedFile[]) {
  await vscode.commands.executeCommand(
    'vscode.changes',
    commitDiffTitle(commit),
    changesResources(model.root, commitDiffEntries(commit, files)),
  )
}

const interdiffQuerySchema = z.object({ root: z.string(), from: z.string(), to: z.string() })

function interdiffUri(root: string, from: EvolutionEntry, to: EvolutionEntry): vscode.Uri {
  return vscode.Uri.from({
    scheme: INTERDIFF_SCHEME,
    path: `/${from.commitPrefix}..${to.commitPrefix}.diff`,
    query: JSON.stringify({ root, from: from.commitId, to: to.commitId }),
  })
}

export class InterdiffContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly registry: RepoRegistry) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    let query: z.infer<typeof interdiffQuerySchema>
    try {
      query = interdiffQuerySchema.parse(JSON.parse(uri.query))
    } catch {
      return ''
    }
    const model = this.registry.modelFor(query.root)
    if (!model) {
      return ''
    }
    return interdiffText(model, query.from, query.to)
  }
}

export async function openVersionDiff(
  model: RepoModel,
  commit: CommitView,
  from: EvolutionEntry,
  to: EvolutionEntry,
) {
  const entries = await versionDiffEntries(model, from, to)
  if (entries.length === 0) {
    const document = await vscode.workspace.openTextDocument(interdiffUri(model.root, from, to))
    await vscode.window.showTextDocument(document, { preview: true })
    return
  }
  await vscode.commands.executeCommand(
    'vscode.changes',
    versionDiffTitle(commit, from, to),
    changesResources(model.root, entries),
  )
}

export async function openFileAtRevision(model: RepoModel, commit: CommitView, path: string) {
  const uri = sideUri(model.root, fileAtRevision(commit, path))
  await vscode.commands.executeCommand('vscode.open', uri, { preview: false })
}
