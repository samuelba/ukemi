// Messages of the desktop editor tab, which edits one file of a change and resolves its conflicts.

export interface EditorState {
  changeId: string
  // The change id as the graph shows it.
  changeLabel: string
  commitId: string
  isWorkingCopy: boolean
  path: string
  text: string
  // Hash of `text` as loaded. Saving sends it back, so the host can tell whether the file
  // changed underneath the editor.
  baseHash: string
  // Why the file cannot be edited, or null.
  readOnly: string | null
  // The change's conflicted files, for the list beside the editor.
  conflictedPaths: string[]
}

export type EditorHostMessage =
  | { type: 'load'; state: EditorState }
  | { type: 'busy'; label: string | null }
  | { type: 'error'; text: string }
  // Asks the tab to switch files. It answers with `openPath`, saying whether it has edits.
  | { type: 'show'; path: string }

export type EditorWebviewMessage =
  | { type: 'ready' }
  | { type: 'save'; text: string; baseHash: string }
  | { type: 'reload' }
  | { type: 'openPath'; path: string; isDirty: boolean }
  | { type: 'openExternal' }
  | { type: 'close'; isDirty: boolean }
