import { canRestoreVersion, operationLabel } from '../../shared/evolution'
import { relativeTime, shortId } from '../../shared/format'
import type { EvolutionEntry } from '../../shared/model'

export interface EvolutionVersionNode {
  kind: 'version'
  repoId: string
  commitId: string
  changeId: string
  versionCommitId: string
  previousCommitId: string | null
  label: string
  description: string
  tooltip: string
  contextValue: string
  id: string
}

interface VersionCommit {
  repoId: string
  commitId: string
  changeId: string
  isImmutable: boolean
}

interface VersionOptions {
  now: number
  changeIdLength: number
}

export function evolutionVersionNodes(
  entries: readonly EvolutionEntry[],
  commit: VersionCommit,
  options: VersionOptions,
): EvolutionVersionNode[] {
  return entries.map((entry, index) => versionNode(entries, entry, index, commit, options))
}

export function isEvolutionVersionNode(arg: unknown): arg is EvolutionVersionNode {
  if (typeof arg !== 'object' || arg === null) {
    return false
  }
  const value = arg as { kind?: unknown; repoId?: unknown; versionCommitId?: unknown }
  return (
    value.kind === 'version' &&
    typeof value.repoId === 'string' &&
    typeof value.versionCommitId === 'string'
  )
}

function versionNode(
  entries: readonly EvolutionEntry[],
  entry: EvolutionEntry,
  index: number,
  commit: VersionCommit,
  options: VersionOptions,
): EvolutionVersionNode {
  const previous = entries[index + 1]
  const flags = ['version']
  if (previous) {
    flags.push('openable')
  }
  if (index > 0) {
    flags.push('comparable')
  }
  if (!commit.isImmutable && canRestoreVersion(entries, index)) {
    flags.push('restorable')
  }
  const operation = operationLabel(entry.operation)
  const when = relativeTime(entry.timestamp, options.now)
  return {
    kind: 'version',
    repoId: commit.repoId,
    commitId: commit.commitId,
    changeId: commit.changeId,
    versionCommitId: entry.commitId,
    previousCommitId: previous?.commitId ?? null,
    label: shortId(entry.commitId, entry.commitPrefix, options.changeIdLength),
    description: [index === 0 ? 'current' : '', operation, when]
      .filter((part) => part.length > 0)
      .join(' '),
    tooltip: operation,
    contextValue: flags.join(':'),
    id: `${commit.repoId}\n${commit.changeId}\n${entry.commitId}`,
  }
}
