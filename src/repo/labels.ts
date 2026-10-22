import { basename, relative, sep } from 'node:path'

export interface FolderInfo {
  name: string
  path: string
}

export function repoLabel(root: string, folders: readonly FolderInfo[]): string {
  const containing = folders
    .filter((f) => root === f.path || root.startsWith(f.path + sep))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (!containing) {
    return basename(root)
  }
  const rel = relative(containing.path, root).split(sep).join('/')
  if (folders.length > 1) {
    return rel ? `${containing.name}/${rel}` : containing.name
  }
  return rel || basename(root)
}
