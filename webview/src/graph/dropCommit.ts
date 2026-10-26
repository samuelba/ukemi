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
