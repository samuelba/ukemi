import type { WebviewMessage } from '../../../shared/protocol'

export interface FilePreviewData {
  readonly [key: string]: string | undefined
}

// What a file row shows when the arrows land on it: its diff, like a click, but never the conflict
// editor, which opens a tab. Commit and folder rows carry no preview data and open nothing.
export function filePreviewMessage(data: FilePreviewData): WebviewMessage | null {
  const commitId = data.previewCommitId
  const path = data.previewPath
  if (!commitId || !path) {
    return null
  }
  return { type: 'openFile', commitId, path, mode: 'diff' }
}
