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
  // The row below, when it is a parent of this row and this row is mutable.
  below: string | null
}

interface GapCommit {
  commitId: string
  parents: readonly string[]
  isImmutable: boolean
}

/** A change can be dropped between two adjacent rows joined by a graph edge. */
export function insertGaps(commits: readonly GapCommit[]): InsertGaps[] {
  const joined = (upper: GapCommit | undefined, lower: GapCommit | undefined) =>
    upper !== undefined &&
    lower !== undefined &&
    !upper.isImmutable &&
    upper.parents.includes(lower.commitId)
  return commits.map((commit, i) => {
    const prev = commits[i - 1]
    const next = commits[i + 1]
    return {
      above: joined(prev, commit) ? (prev?.commitId ?? null) : null,
      below: joined(commit, next) ? (next?.commitId ?? null) : null,
    }
  })
}
