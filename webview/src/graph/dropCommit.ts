import type { DropAction, DropMode, FileDropAction } from '../../../shared/protocol'

/** Alt includes descendants for a duplicate and limits a rebase to one change. */
export function dropCommitAction(
  copy: boolean,
  alt: boolean,
): { action: DropAction; mode: DropMode } {
  if (copy) {
    return { action: 'duplicate', mode: alt ? 'source' : 'revision' }
  }
  return { action: 'rebase', mode: alt ? 'revision' : 'source' }
}

/** Ctrl copies a file. A plain drag cannot move a file out of an immutable change. */
export function fileDropAction(copy: boolean, sourceImmutable: boolean): FileDropAction | null {
  if (copy) {
    return 'copy'
  }
  return sourceImmutable ? null : 'move'
}

/** Inserting between two changes reorders by default, so it moves one change unless Alt is held. */
export function insertCommitAction(
  copy: boolean,
  alt: boolean,
): { action: DropAction; mode: DropMode } {
  return { action: copy ? 'duplicate' : 'rebase', mode: alt ? 'source' : 'revision' }
}

export type InsertEdge = 'above' | 'below'

const EDGE_PX = 6

/** The band at the top or bottom of a row that drops between it and its neighbour. */
export function insertEdge(offsetY: number, height: number): InsertEdge | null {
  const band = Math.min(EDGE_PX, height / 4)
  if (offsetY < band) {
    return 'above'
  }
  if (offsetY > height - band) {
    return 'below'
  }
  return null
}

export interface InsertGaps {
  // The row above, when it is a mutable child of this row.
  above: string | null
  // The parent of this mutable row: the row below when it is one, else its only parent when shown.
  below: string | null
  // The top row, where a drop above places the change on it.
  top: boolean
}

interface GapCommit {
  commitId: string
  parents: readonly string[]
  isImmutable: boolean
}

/** A change can be dropped between a row and its parent, or above the top row. */
export function insertGaps(commits: readonly GapCommit[]): InsertGaps[] {
  const shown = new Set(commits.map((commit) => commit.commitId))
  const joined = (upper: GapCommit, lower: GapCommit) =>
    !upper.isImmutable && upper.parents.includes(lower.commitId)
  const parentBelow = (commit: GapCommit, next: GapCommit | undefined): string | null => {
    if (next && joined(commit, next)) {
      return next.commitId
    }
    const [only, ...rest] = commit.parents
    return !commit.isImmutable && only !== undefined && rest.length === 0 && shown.has(only)
      ? only
      : null
  }
  return commits.map((commit, i) => {
    const prev = commits[i - 1]
    return {
      above: prev && joined(prev, commit) ? prev.commitId : null,
      below: parentBelow(commit, commits[i + 1]),
      top: i === 0,
    }
  })
}
