import { useMemo, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from 'react'
import { FILE_STATUS_LETTER, type ChangedFile } from '../../../shared/model'
import type { ChangedFilesView, CommitView } from '../../../shared/protocol'
import { fileDragTransfer } from '../../../shared/fileUri'
import { splitPath } from '../shared/format'
import { isDesktop, postMessage, vscodeContext } from '../shared/hostApi'
import { filePreviewMessage } from './previewFile'
import { dragModifiers } from './dragModifiers'
import { buildFileTree, type FileTreeNode } from '../../../shared/fileTree'
import { FileTypeIcon } from './FileIcon'
import { LineStats } from './LineStats'
import { fileLabel } from './rowStatus'
import { treeKeyAction } from './treeKeys'
import { onTreeKeyDown } from './treeNav'

export const FILE_MIME = 'application/x-ukemi-file'
export const FILE_LOCKED_MIME = 'application/x-ukemi-file-locked'
const URI_LIST_MIME = 'text/uri-list'
// Workbench drag type that chat (Cursor and VS Code) turns into a file attachment.
const RESOURCE_URLS_MIME = 'ResourceURLs'

interface FileListProps {
  commit: CommitView
  files: ChangedFile[] | undefined
  repoId: string
  showFullPaths: boolean
  showLineStats: boolean
  changedFilesView: ChangedFilesView
  // The aria-level of the top rows: 2 under a commit row of the graph tree, 1 where the list is a
  // tree of its own (the desktop detail pane).
  level: number
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
  level: number
  isTabStop: boolean
}

function depthStyle(depth: number): CSSProperties {
  return { '--file-depth': depth } as CSSProperties
}

interface DiscardButtonProps {
  title: string
  command: string
  context: { repoId: string; commitId: string; path: string }
}

// Sits inside a row that opens on click and double click, so neither may reach the row. Out of the
// tab order: the row has the keyboard, and Discard is in its context menu.
function DiscardButton({ title, command, context }: DiscardButtonProps) {
  return (
    <button
      type="button"
      className="icon-button"
      title={title}
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation()
        if (event.detail > 1) {
          return
        }
        postMessage({ type: 'command', command, context })
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <i className="codicon codicon-discard" />
    </button>
  )
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
  level,
  isTabStop,
}: FileRowProps) {
  const { name, dir } = splitPath(file.path)
  const open = (mode: 'diff' | 'file') =>
    postMessage({ type: 'openFile', commitId: commit.commitId, path: file.path, mode })
  const onDragStart = (event: DragEvent) => {
    event.stopPropagation()
    dragModifiers.onDragStart(event, false)
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
      role="treeitem"
      aria-level={level + depth}
      aria-label={fileLabel(file)}
      tabIndex={isTabStop ? 0 : -1}
      title={file.sourcePath !== file.path ? `${file.sourcePath} → ${file.path}` : file.path}
      data-preview-commit-id={commit.commitId}
      data-preview-path={file.path}
      draggable
      style={depthStyle(depth)}
      onDragStart={onDragStart}
      onDragEnd={() => dragModifiers.onDragEnd()}
      onClick={(event) => {
        event.stopPropagation()
        open(file.isConflicted ? 'file' : 'diff')
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        open('file')
      }}
      onKeyDown={(event) => {
        // Enter does what a click does, Shift+Enter what a double click does.
        if (event.target !== event.currentTarget) {
          return
        }
        const action = treeKeyAction(event)
        if (action === 'activate' || action === 'open') {
          event.preventDefault()
          open(action === 'open' || file.isConflicted ? 'file' : 'diff')
        }
      }}
      data-vscode-context={vscodeContext({
        webviewSection: 'ukemi.file',
        repoId,
        commitId: commit.commitId,
        path: file.path,
        isImmutable: commit.isImmutable,
        isWorkingCopy: commit.isWorkingCopy,
        isRemoved: file.status === 'removed',
        isConflicted: file.isConflicted,
        canSplit,
      })}
    >
      <FileTypeIcon path={file.path} />
      <span className="file-name">{showFullPaths ? file.path : name}</span>
      {showDirectory && dir && <span className="file-dir">{dir}</span>}
      <span className="file-trailing">
        {!commit.isImmutable && (
          <span className="actions">
            <DiscardButton
              title="Discard changes"
              command="ukemi.file.discard"
              context={{ repoId, commitId: commit.commitId, path: file.path }}
            />
          </span>
        )}
        {showLineStats && (
          <LineStats added={file.linesAdded ?? 0} removed={file.linesRemoved ?? 0} />
        )}
        <span className="file-status">
          {file.isConflicted ? '!' : FILE_STATUS_LETTER[file.status]}
        </span>
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
  level: number
  tabStop: string | null
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
  level,
  tabStop,
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
          level={level}
          isTabStop={tabStop === node.file.path}
        />
      )
    }
    const isCollapsed = collapsed.has(node.path)
    const directoryContext = vscodeContext({
      webviewSection: 'ukemi.directory',
      repoId,
      commitId: commit.commitId,
      path: node.path,
      isImmutable: commit.isImmutable,
    })
    return (
      <li
        key={node.path}
        className="file-folder"
        role="treeitem"
        aria-level={level + depth}
        aria-expanded={!isCollapsed}
        aria-label={node.name}
        tabIndex={tabStop === node.path ? 0 : -1}
        onKeyDown={(event) => {
          // The collapse state lives here, so the folder opens and closes itself. Right on an open
          // folder and Left on a closed one move, which the tree does.
          if (event.target !== event.currentTarget) {
            return
          }
          const action = treeKeyAction(event)
          if (
            action === 'activate' ||
            (action === 'expand' && isCollapsed) ||
            (action === 'collapse' && !isCollapsed)
          ) {
            event.preventDefault()
            onToggle(node.path)
          }
        }}
      >
        <div
          className="file file-dir-row"
          style={depthStyle(depth)}
          data-vscode-context={directoryContext}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(node.path)
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="file-dir-toggle"
            tabIndex={-1}
            onClick={(event) => {
              event.stopPropagation()
              onToggle(node.path)
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <i className={`codicon codicon-chevron-${isCollapsed ? 'right' : 'down'}`} />
            <span className="file-name">{node.name}</span>
          </button>
          {!commit.isImmutable && (
            <span className="file-trailing">
              <span className="actions">
                <DiscardButton
                  title="Discard changes in this folder"
                  command="ukemi.file.discardDirectory"
                  context={{ repoId, commitId: commit.commitId, path: node.path }}
                />
              </span>
            </span>
          )}
        </div>
        {!isCollapsed && (
          <ul className="file-children" role="group">
            <FileTreeItems
              commit={commit}
              repoId={repoId}
              canSplit={canSplit}
              showLineStats={showLineStats}
              nodes={node.children}
              depth={depth + 1}
              level={level}
              tabStop={tabStop}
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
  level,
}: {
  commit: CommitView
  files: ChangedFile[]
  repoId: string
  showLineStats: boolean
  level: number
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
  const first = nodes[0]
  const tabStop =
    level === 1 && first ? (first.kind === 'file' ? first.file.path : first.path) : null
  return (
    <ul className="files file-tree" {...listRole(level)}>
      <FileTreeItems
        commit={commit}
        repoId={repoId}
        canSplit={files.length > 1 && !commit.isImmutable}
        showLineStats={showLineStats}
        nodes={nodes}
        depth={0}
        level={level}
        tabStop={tabStop}
        collapsed={collapsed}
        onToggle={toggle}
      />
    </ul>
  )
}

// Nested under a commit row the files are a group of it. On their own they are a tree, whose first
// row is the tab stop.
function listRole(level: number) {
  return level === 1
    ? {
        role: 'tree',
        'aria-label': 'Changed files',
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => onTreeKeyDown(event, previewMovedFile),
      }
    : { role: 'group' }
}

// The desktop shows a diff in place, so moving onto a file shows its diff. VS Code would open an
// editor tab per step, so there the arrows only move.
export function previewMovedFile(item: HTMLElement): void {
  if (!isDesktop) {
    return
  }
  const message = filePreviewMessage(item.dataset)
  if (message) {
    postMessage(message)
  }
}

export function FileList({
  commit,
  files,
  repoId,
  showFullPaths,
  showLineStats,
  changedFilesView,
  level,
}: FileListProps) {
  if (!files) {
    return (
      <div className="files muted" role="none">
        Loading files…
      </div>
    )
  }
  if (files.length === 0) {
    return (
      <div className="files muted" role="none">
        No changed files
      </div>
    )
  }
  if (changedFilesView === 'tree') {
    return (
      <FileTree
        commit={commit}
        files={files}
        repoId={repoId}
        showLineStats={showLineStats}
        level={level}
      />
    )
  }
  const canSplit = files.length > 1 && !commit.isImmutable
  return (
    <ul className="files" {...listRole(level)}>
      {files.map((file, index) => (
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
          level={level}
          isTabStop={level === 1 && index === 0}
        />
      ))}
    </ul>
  )
}
