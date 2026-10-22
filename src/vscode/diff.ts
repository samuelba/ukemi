import { basename, join } from 'node:path'
import * as vscode from 'vscode'
import type { ChangedFile } from '../../shared/model'
import type { CommitView } from '../../shared/protocol'
import type { RepoModel } from '../repo/repoModel'
import type { RepoRegistry } from './registry'

export const DIFF_SCHEME = 'ukemi'
const BINARY_PLACEHOLDER = '(binary file)'

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

function parseQuery(uri: vscode.Uri): DiffQuery | null {
  try {
    const value: unknown = JSON.parse(uri.query)
    if (
      typeof value === 'object' &&
      value !== null &&
      'root' in value &&
      'commitId' in value &&
      'path' in value
    ) {
      const { root, commitId, path } = value as Record<string, unknown>
      if (typeof root === 'string' && typeof commitId === 'string' && typeof path === 'string') {
        return { root, commitId, path }
      }
    }
  } catch {
    return null
  }
  return null
}

function looksBinary(data: Buffer): boolean {
  return data.subarray(0, 8000).includes(0)
}

export class RevisionContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly registry: RepoRegistry) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const query = parseQuery(uri)
    const model = query ? this.registry.modelFor(query.root) : null
    if (!query || !model) {
      return ''
    }
    try {
      const data = await model.repo.fileContent(query.commitId, query.path)
      return looksBinary(data) ? BINARY_PLACEHOLDER : data.toString('utf8')
    } catch {
      return ''
    }
  }
}

function changeLabel(commit: CommitView): string {
  return commit.changeId.slice(0, Math.max(8, commit.changePrefix.length))
}

function diffSides(model: RepoModel, commit: CommitView, file: ChangedFile) {
  const parent = commit.parents[0]
  const left = parent ? revisionUri(model.root, parent, file.sourcePath) : undefined
  const fileUri = vscode.Uri.file(join(model.root, file.path))
  const right =
    commit.isWorkingCopy && file.status !== 'removed'
      ? fileUri
      : revisionUri(model.root, commit.commitId, file.path)
  return { left, right, fileUri }
}

export async function openFileDiff(model: RepoModel, commit: CommitView, file: ChangedFile) {
  const { left, right } = diffSides(model, commit, file)
  const title = `${basename(file.path)} (${changeLabel(commit)})`
  if (!left || file.status === 'added') {
    await vscode.commands.executeCommand('vscode.open', right, { preview: true })
    return
  }
  await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true })
}

export async function openCommitDiff(model: RepoModel, commit: CommitView, files: ChangedFile[]) {
  const title = `${changeLabel(commit)}: ${commit.description.split('\n')[0] || '(no description)'}`
  const resources = files.map((file) => {
    const { left, right, fileUri } = diffSides(model, commit, file)
    return [
      fileUri,
      file.status === 'added' ? undefined : left,
      file.status === 'removed' ? undefined : right,
    ]
  })
  await vscode.commands.executeCommand('vscode.changes', title, resources)
}

export async function openFileAtRevision(model: RepoModel, commit: CommitView, path: string) {
  const uri = commit.isWorkingCopy
    ? vscode.Uri.file(join(model.root, path))
    : revisionUri(model.root, commit.commitId, path)
  await vscode.commands.executeCommand('vscode.open', uri, { preview: false })
}
