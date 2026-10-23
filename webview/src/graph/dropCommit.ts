import type { DropAction, DropMode } from '../../../shared/protocol'

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
