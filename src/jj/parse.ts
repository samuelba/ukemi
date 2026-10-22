import { z } from 'zod'
import type {
  ChangedFile,
  Commit,
  EvolutionEntry,
  Operation,
  Remote,
  Workspace,
} from '../../shared/model'

const signatureSchema = z.object({
  name: z.string(),
  email: z.string(),
  timestamp: z.string(),
})

const logEntrySchema = z.object({
  change_id: z.string(),
  change_prefix: z.string(),
  commit_id: z.string(),
  commit_prefix: z.string(),
  parents: z.array(z.string()),
  description: z.string(),
  author: signatureSchema,
  committer: signatureSchema,
  local_bookmarks: z.array(
    z.object({ name: z.string(), synced: z.boolean(), conflict: z.boolean() }),
  ),
  remote_bookmarks: z.array(
    z.object({ name: z.string(), remote: z.string(), tracked: z.boolean() }),
  ),
  tags: z.array(z.string()),
  working_copies: z.array(z.string()),
  change_offset: z.number().nullable(),
  is_working_copy: z.boolean(),
  is_empty: z.boolean(),
  has_conflict: z.boolean(),
  is_immutable: z.boolean(),
  is_divergent: z.boolean(),
  is_hidden: z.boolean(),
  is_mine: z.boolean(),
  is_pushed: z.boolean(),
})

const fileStatusSchema = z.enum(['added', 'modified', 'removed', 'renamed', 'copied'])

const filesEntrySchema = z.object({
  files: z.array(z.object({ path: z.string(), status: fileStatusSchema, source: z.string() })),
  conflicted: z.array(z.string()),
})

const workspaceSchema = z.object({
  name: z.string(),
  root: z.string().nullable(),
  commit_id: z.string(),
})

const diffFileSchema = z.object({ path: z.string(), status: fileStatusSchema, source: z.string() })

const evolutionSchema = z.object({
  commit_id: z.string(),
  commit_prefix: z.string(),
  parents: z.array(z.string()),
  description: z.string(),
  timestamp: z.string(),
  is_empty: z.boolean(),
  operation: z.string(),
})

const operationSchema = z.object({
  id: z.string(),
  description: z.string(),
  time: z.string(),
})

function parseLines<T>(output: string, schema: z.ZodType<T>, what: string): T[] {
  return output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        throw new Error(`Unexpected ${what} output from jj: ${line.slice(0, 200)}`)
      }
      const result = schema.safeParse(value)
      if (!result.success) {
        throw new Error(
          `Unexpected ${what} output from jj: ${result.error.issues[0]?.message ?? ''}`,
        )
      }
      return result.data
    })
}

export function parseLog(output: string): Commit[] {
  return parseLines(output, logEntrySchema, 'log').map((entry) => ({
    changeId: entry.change_id,
    changePrefix: entry.change_prefix,
    commitId: entry.commit_id,
    commitPrefix: entry.commit_prefix,
    parents: entry.parents,
    description: entry.description,
    author: entry.author,
    committer: entry.committer,
    localBookmarks: entry.local_bookmarks,
    remoteBookmarks: entry.remote_bookmarks.filter((b) => b.remote !== 'git'),
    tags: entry.tags,
    workingCopies: entry.working_copies,
    changeOffset: entry.is_divergent ? entry.change_offset : null,
    isWorkingCopy: entry.is_working_copy,
    isEmpty: entry.is_empty,
    hasConflict: entry.has_conflict,
    isImmutable: entry.is_immutable,
    isDivergent: entry.is_divergent,
    isHidden: entry.is_hidden,
    isMine: entry.is_mine,
    isPushed: entry.is_pushed,
  }))
}

export function parseFiles(output: string): ChangedFile[] {
  const [entry] = parseLines(output, filesEntrySchema, 'file list')
  if (!entry) {
    return []
  }
  const conflicted = new Set(entry.conflicted)
  const changed = entry.files.map((file) => ({
    path: file.path,
    sourcePath: file.source,
    status: file.status,
    isConflicted: conflicted.has(file.path),
  }))
  const changedPaths = new Set(changed.map((file) => file.path))
  const conflictOnly = entry.conflicted
    .filter((path) => !changedPaths.has(path))
    .map((path) => ({ path, sourcePath: path, status: 'modified' as const, isConflicted: true }))
  return [...changed, ...conflictOnly]
}

export function parseWorkspaces(output: string): Workspace[] {
  return parseLines(output, workspaceSchema, 'workspace').map((entry) => ({
    name: entry.name,
    root: entry.root,
    commitId: entry.commit_id,
  }))
}

export function parseEvolution(output: string): EvolutionEntry[] {
  return parseLines(output, evolutionSchema, 'evolution').map((entry) => ({
    commitId: entry.commit_id,
    commitPrefix: entry.commit_prefix,
    parents: entry.parents,
    description: entry.description,
    timestamp: entry.timestamp,
    isEmpty: entry.is_empty,
    operation: entry.operation,
  }))
}

export function parseDiffFiles(output: string): ChangedFile[] {
  return parseLines(output, diffFileSchema, 'diff').map((file) => ({
    path: file.path,
    sourcePath: file.source,
    status: file.status,
    isConflicted: false,
  }))
}

export function parseOperations(output: string): Operation[] {
  return parseLines(output, operationSchema, 'operation')
}

export function parseRemotes(output: string): Remote[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name = '', url = ''] = line.split(/\s+/, 2)
      return { name, url }
    })
    .filter((remote) => remote.name.length > 0 && remote.url.length > 0)
}

export function parseCommitIds(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[0-9a-f]{40}$/.test(line))
}

export interface JjVersion {
  major: number
  minor: number
  patch: number
}

export function parseVersion(output: string): JjVersion | null {
  const match = /jj\s+(\d+)\.(\d+)\.(\d+)/.exec(output)
  if (!match) {
    return null
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

export function isVersionAtLeast(version: JjVersion, minimum: JjVersion): boolean {
  if (version.major !== minimum.major) {
    return version.major > minimum.major
  }
  if (version.minor !== minimum.minor) {
    return version.minor > minimum.minor
  }
  return version.patch >= minimum.patch
}
