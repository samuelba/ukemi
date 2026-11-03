// What the editor does with a file the host sent:
// - replace: show it, dropping the document and its undo history.
// - rebase: the host sent back what the user just saved, so keep the document, its undo history
//   and anything typed while saving, and take the saved text as the new baseline.
// - keep: ignore it, since the user has edits. Saving then finds the file changed and asks.
export type LoadAction = 'replace' | 'rebase' | 'keep'

export interface LoadInput {
  shown: { path: string } | null
  next: { path: string; text: string }
  // The text of a save that has not come back yet.
  saving: string | null
  // The user asked to drop the edits and load the file again.
  reverting: boolean
  isDirty: boolean
}

export function loadAction({ shown, next, saving, reverting, isDirty }: LoadInput): LoadAction {
  if (!shown || shown.path !== next.path || reverting) {
    return 'replace'
  }
  if (saving !== null) {
    // Otherwise the user chose to reload rather than overwrite a file that changed meanwhile.
    return next.text === saving ? 'rebase' : 'replace'
  }
  return isDirty ? 'keep' : 'replace'
}
