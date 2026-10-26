import type { ChangedFile } from './model'

export interface FileTreeDir {
  kind: 'dir'
  name: string
  path: string
  children: FileTreeNode[]
}

export interface FileTreeFile {
  kind: 'file'
  name: string
  file: ChangedFile
}

export type FileTreeNode = FileTreeDir | FileTreeFile

interface DirDraft {
  name: string
  path: string
  dirs: Map<string, DirDraft>
  files: FileTreeFile[]
}

function draft(name: string, path: string): DirDraft {
  return { name, path, dirs: new Map(), files: [] }
}

function insert(root: DirDraft, file: ChangedFile): void {
  const parts = file.path.split('/').filter((part) => part.length > 0)
  const name = parts.at(-1)
  if (!name) {
    return
  }
  let cursor = root
  for (const segment of parts.slice(0, -1)) {
    const path = cursor.path ? `${cursor.path}/${segment}` : segment
    const existing = cursor.dirs.get(segment)
    if (existing) {
      cursor = existing
      continue
    }
    const next = draft(segment, path)
    cursor.dirs.set(segment, next)
    cursor = next
  }
  cursor.files.push({ kind: 'file', name, file })
}

function compact(dir: FileTreeDir): FileTreeDir {
  const children = dir.children.map((child) => (child.kind === 'dir' ? compact(child) : child))
  const only = children.length === 1 ? children[0] : undefined
  if (only?.kind !== 'dir') {
    return { ...dir, children }
  }
  return compact({
    kind: 'dir',
    name: `${dir.name}/${only.name}`,
    path: only.path,
    children: only.children,
  })
}

function childNodes(dirs: readonly FileTreeDir[], files: readonly FileTreeFile[]): FileTreeNode[] {
  return [...dirs, ...files]
}

function finish(dir: DirDraft): FileTreeDir {
  const children = childNodes([...dir.dirs.values()].map(finish), dir.files)
  return compact({ kind: 'dir', name: dir.name, path: dir.path, children })
}

export function buildFileTree(files: readonly ChangedFile[]): FileTreeNode[] {
  const root = draft('', '')
  for (const file of files) {
    insert(root, file)
  }
  return childNodes([...root.dirs.values()].map(finish), root.files)
}

export function changedPathsInDirectory(
  files: readonly { path: string }[],
  directory: string,
): string[] {
  if (directory.length === 0) {
    return []
  }
  const prefix = `${directory}/`
  return files.filter((file) => file.path.startsWith(prefix)).map((file) => file.path)
}
