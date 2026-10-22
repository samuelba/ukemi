import type { DragEvent } from 'react'
import type { ChangedFile } from '../../../shared/model'
import type { CommitView } from '../../../shared/protocol'
import { splitPath } from '../shared/format'
import { postMessage, vscodeContext } from '../shared/vscodeApi'

export const FILE_MIME = 'application/x-ukemi-file'

const STATUS_LETTER: Record<ChangedFile['status'], string> = {
  added: 'A',
  modified: 'M',
  removed: 'D',
  renamed: 'R',
  copied: 'C',
}

interface FileListProps {
  commit: CommitView
  files: ChangedFile[] | undefined
  repoId: string
  showFullPaths: boolean
}

export function FileList({ commit, files, repoId, showFullPaths }: FileListProps) {
  if (!files) {
    return <div className="files muted">Loading files…</div>
  }
  if (files.length === 0) {
    return <div className="files muted">No changed files</div>
  }
  const open = (path: string, mode: 'diff' | 'file') =>
    postMessage({ type: 'openFile', commitId: commit.commitId, path, mode })

  return (
    <ul className="files">
      {files.map((file) => {
        const { name, dir } = splitPath(file.path)
        const onDragStart = (event: DragEvent) => {
          event.stopPropagation()
          event.dataTransfer.setData(
            FILE_MIME,
            JSON.stringify({ commitId: commit.commitId, path: file.path }),
          )
          event.dataTransfer.effectAllowed = 'move'
        }
        return (
          <li
            key={file.path}
            className={`file status-${file.status}${file.isConflicted ? ' conflicted' : ''}`}
            title={file.sourcePath !== file.path ? `${file.sourcePath} → ${file.path}` : file.path}
            draggable={!commit.isImmutable}
            onDragStart={onDragStart}
            onClick={(e) => {
              e.stopPropagation()
              open(file.path, file.isConflicted ? 'file' : 'diff')
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              open(file.path, 'file')
            }}
            data-vscode-context={vscodeContext({
              webviewSection: 'file',
              repoId,
              commitId: commit.commitId,
              path: file.path,
              isImmutable: commit.isImmutable,
              canSplit: files.length > 1 && !commit.isImmutable,
            })}
          >
            <span className="file-status">
              {file.isConflicted ? '!' : STATUS_LETTER[file.status]}
            </span>
            <span className="file-name">{showFullPaths ? file.path : name}</span>
            {!showFullPaths && dir && <span className="file-dir">{dir}</span>}
          </li>
        )
      })}
    </ul>
  )
}
