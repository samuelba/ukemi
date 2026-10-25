import { useMemo, useState, type CSSProperties, type DragEvent } from 'react'
import type { ChangedFile } from '../../../shared/model'
import type { ChangedFilesView, CommitView } from '../../../shared/protocol'
import { fileDragTransfer } from '../../../shared/fileUri'
import { splitPath } from '../shared/format'
import { postMessage, vscodeContext } from '../shared/vscodeApi'
import { buildFileTree, type FileTreeNode } from '../../../shared/fileTree'
import { FileTypeIcon } from './FileIcon'
import { LineStats } from './LineStats'

export const FILE_MIME = 'application/x-ukemi-file'
export const FILE_LOCKED_MIME = 'application/x-ukemi-file-locked'
const URI_LIST_MIME = 'text/uri-list'
// Workbench drag type that chat (Cursor and VS Code) turns into a file attachment.
const RESOURCE_URLS_MIME = 'ResourceURLs'

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
  showLineStats: boolean
  changedFilesView: ChangedFilesView
}

interface FileRowProps {
  commit: CommitView
  file: ChangedFile
  repoId: string
  canSplit: boolean
  showFullPaths: boolean
  showLineStats: boolean
  showDirectory: boolean
  depth: number
}

function depthStyle(depth: number): CSSProperties {
  return { '--file-depth': depth } as CSSProperties
}

function FileRow({
  commit,
  file,
  repoId,
  canSplit,
  showFullPaths,
  showLineStats,
  showDirectory,
  depth,
}: FileRowProps) {
  const { name, dir } = splitPath(file.path)
  const open = (mode: 'diff' | 'file') =>
    postMessage({ type: 'openFile', commitId: commit.commitId, path: file.path, mode })
  const onDragStart = (event: DragEvent) => {
    event.stopPropagation()
    const drag = fileDragTransfer(repoId, commit, file)
    event.dataTransfer.setData(FILE_MIME, drag.payload)
    if (drag.locked) {
      event.dataTransfer.setData(FILE_LOCKED_MIME, '1')
    }
    if (drag.uriList) {
      event.dataTransfer.setData(URI_LIST_MIME, drag.uriList)
    }
    if (drag.resourceUrls) {
      event.dataTransfer.setData(RESOURCE_URLS_MIME, drag.resourceUrls)
    }
    event.dataTransfer.effectAllowed = 'copyMove'
  }
  return (
    <li
      className={`file status-${file.status}${file.isConflicted ? ' conflicted' : ''}`}
      title={file.sourcePath !== file.path ? `${file.sourcePath} → ${file.path}` : file.path}
      draggable
      style={depthStyle(depth)}
      onDragStart={onDragStart}
      onClick={(event) => {
        event.stopPropagation()
        open(file.isConflicted ? 'file' : 'diff')
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        open('file')
      }}
      data-vscode-context={vscodeContext({
        webviewSection: 'file',
        repoId,
        commitId: commit.commitId,
        path: file.path,
        isImmutable: commit.isImmutable,
        isRemoved: file.status === 'removed',
        canSplit,
      })}
    >
      <FileTypeIcon path={file.path} />
      <span className="file-name">{showFullPaths ? file.path : name}</span>
      {showDirectory && dir && <span className="file-dir">{dir}</span>}
      <span className="file-trailing">
        {!commit.isImmutable && (
          <span className="actions">
            <button
              type="button"
              className="icon-button"
              title="Discard changes"
              onClick={(event) => {
                event.stopPropagation()
                if (event.detail > 1) {
                  return
                }
                postMessage({
                  type: 'command',
                  command: 'ukemi.file.discard',
                  context: { repoId, commitId: commit.commitId, path: file.path },
                })
              }}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <i className="codicon codicon-discard" />
            </button>
          </span>
        )}
        {showLineStats && (
          <LineStats added={file.linesAdded ?? 0} removed={file.linesRemoved ?? 0} />
        )}
        <span className="file-status">{file.isConflicted ? '!' : STATUS_LETTER[file.status]}</span>
      </span>
    </li>
  )
}

interface TreeProps {
  commit: CommitView
  repoId: string
  canSplit: boolean
  showLineStats: boolean
  nodes: readonly FileTreeNode[]
  depth: number
  collapsed: ReadonlySet<string>
  onToggle: (path: string) => void
}

function FileTreeItems({
  commit,
  repoId,
  canSplit,
  showLineStats,
  nodes,
  depth,
  collapsed,
  onToggle,
}: TreeProps) {
  return nodes.map((node) => {
    if (node.kind === 'file') {
      return (
        <FileRow
          key={node.file.path}
          commit={commit}
          file={node.file}
          repoId={repoId}
          canSplit={canSplit}
          showFullPaths={false}
          showLineStats={showLineStats}
          showDirectory={false}
          depth={depth}
        />
      )
    }
    const isCollapsed = collapsed.has(node.path)
    return (
      <li key={node.path} className="file-folder">
        <button
          type="button"
          className="file file-dir-row"
          style={depthStyle(depth)}
          aria-expanded={!isCollapsed}
          data-vscode-context={vscodeContext({ webviewSection: 'directory' })}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(node.path)
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <i className={`codicon codicon-chevron-${isCollapsed ? 'right' : 'down'}`} />
          <span className="file-name">{node.name}</span>
        </button>
        {!isCollapsed && (
          <ul className="file-children">
            <FileTreeItems
              commit={commit}
              repoId={repoId}
              canSplit={canSplit}
              showLineStats={showLineStats}
              nodes={node.children}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          </ul>
        )}
      </li>
    )
  })
}

function FileTree({
  commit,
  files,
  repoId,
  showLineStats,
}: {
  commit: CommitView
  files: ChangedFile[]
  repoId: string
  showLineStats: boolean
}) {
  const nodes = useMemo(() => buildFileTree(files), [files])
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (path: string) => {
    setCollapsed((current) =>
      current.has(path)
        ? new Set([...current].filter((item) => item !== path))
        : new Set([...current, path]),
    )
  }
  return (
    <ul className="files file-tree">
      <FileTreeItems
        commit={commit}
        repoId={repoId}
        canSplit={files.length > 1 && !commit.isImmutable}
        showLineStats={showLineStats}
        nodes={nodes}
        depth={0}
        collapsed={collapsed}
        onToggle={toggle}
      />
    </ul>
  )
}

export function FileList({
  commit,
  files,
  repoId,
  showFullPaths,
  showLineStats,
  changedFilesView,
}: FileListProps) {
  if (!files) {
    return <div className="files muted">Loading files…</div>
  }
  if (files.length === 0) {
    return <div className="files muted">No changed files</div>
  }
  if (changedFilesView === 'tree') {
    return <FileTree commit={commit} files={files} repoId={repoId} showLineStats={showLineStats} />
  }
  const canSplit = files.length > 1 && !commit.isImmutable
  return (
    <ul className="files">
      {files.map((file) => (
        <FileRow
          key={file.path}
          commit={commit}
          file={file}
          repoId={repoId}
          canSplit={canSplit}
          showFullPaths={showFullPaths}
          showLineStats={showLineStats}
          showDirectory
          depth={0}
        />
      ))}
    </ul>
  )
}
