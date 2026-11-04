import { sameParents } from '../../shared/evolution'
import type { ChangedFile, EvolutionEntry } from '../../shared/model'
import type { CommitView } from '../../shared/protocol'
import type { RepoModel } from '../repo/repoModel'

export const BINARY_PLACEHOLDER = '(binary file)'
export const NO_DIFFERENCES = '(These versions have no differences in files or description.)'

// One side of a file diff, with a path relative to the repository root.
export type FileSide =
  { kind: 'revision'; commitId: string; path: string } | { kind: 'disk'; path: string }

// A changed file with what each side shows. A missing side is an added or removed file.
export interface DiffEntry {
  path: string
  left?: FileSide
  right?: FileSide
}

export function changeLabel(commit: Pick<CommitView, 'changeId' | 'changePrefix'>): string {
  return commit.changeId.slice(0, Math.max(8, commit.changePrefix.length))
}

export function commitDiffTitle(commit: CommitView): string {
  return `${changeLabel(commit)}: ${commit.description.split('\n')[0] || '(no description)'}`
}

export function versionDiffTitle(
  commit: CommitView,
  from: EvolutionEntry,
  to: EvolutionEntry,
): string {
  return `${changeLabel(commit)}: ${from.commitPrefix} → ${to.commitPrefix}`
}

// The working copy's own side is the file on disk, so edits in the diff go to the real file.
export function fileDiffSides(
  commit: CommitView,
  file: ChangedFile,
): { left?: FileSide; right: FileSide } {
  const parent = commit.parents[0]
  const left: FileSide | undefined = parent
    ? { kind: 'revision', commitId: parent, path: file.sourcePath }
    : undefined
  const right: FileSide =
    commit.isWorkingCopy && file.status !== 'removed'
      ? { kind: 'disk', path: file.path }
      : { kind: 'revision', commitId: commit.commitId, path: file.path }
  return { left, right }
}

export function commitDiffEntries(commit: CommitView, files: readonly ChangedFile[]): DiffEntry[] {
  return files.map((file) => {
    const { left, right } = fileDiffSides(commit, file)
    return {
      path: file.path,
      ...(file.status === 'added' || !left ? {} : { left }),
      ...(file.status === 'removed' ? {} : { right }),
    }
  })
}

// Versions on different parents compare as a patch, since their files include the rebase.
export async function versionDiffEntries(
  model: RepoModel,
  from: EvolutionEntry,
  to: EvolutionEntry,
): Promise<DiffEntry[]> {
  const files = sameParents(from.parents, to.parents)
    ? await model.repo.diffFiles(from.commitId, to.commitId)
    : []
  return files.map((file) => ({
    path: file.path,
    ...(file.status === 'added'
      ? {}
      : { left: { kind: 'revision' as const, commitId: from.commitId, path: file.sourcePath } }),
    ...(file.status === 'removed'
      ? {}
      : { right: { kind: 'revision' as const, commitId: to.commitId, path: file.path } }),
  }))
}

export function fileAtRevision(commit: CommitView, path: string): FileSide {
  return commit.isWorkingCopy
    ? { kind: 'disk', path }
    : { kind: 'revision', commitId: commit.commitId, path }
}

export function looksBinary(data: Buffer): boolean {
  return data.subarray(0, 8000).includes(0)
}

// A file that does not exist at the revision reads as empty.
export async function revisionBytes(
  model: RepoModel,
  commitId: string,
  path: string,
): Promise<Buffer> {
  try {
    return await model.repo.fileContent(commitId, path)
  } catch {
    return Buffer.alloc(0)
  }
}

export async function revisionText(
  model: RepoModel,
  commitId: string,
  path: string,
): Promise<string> {
  const data = await revisionBytes(model, commitId, path)
  return looksBinary(data) ? BINARY_PLACEHOLDER : data.toString('utf8')
}

export async function interdiffText(model: RepoModel, from: string, to: string): Promise<string> {
  return (await model.repo.interdiff(from, to)) || NO_DIFFERENCES
}
