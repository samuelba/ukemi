import { stat } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { findRepoRootUpwards } from '../repo/discovery'

// What to open for paths dropped on a window or given on the command line.

// A drop of more files than this is a mistake, like a whole selection of a folder's contents.
export const MAX_DROPPED_PATHS = 20

// The paths of a renderer's drop message, or null when they are not a short list of absolute paths.
export function droppedPaths(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DROPPED_PATHS) {
    return null
  }
  const paths = value.filter((path): path is string => typeof path === 'string' && isAbsolute(path))
  return paths.length === value.length ? paths : null
}

async function kindOf(path: string): Promise<'directory' | 'file' | null> {
  try {
    const info = await stat(path)
    return info.isDirectory() ? 'directory' : 'file'
  } catch {
    return null
  }
}

// A folder opens at the root of the repository around it, or as itself outside any. A file opens
// its repository. Anything else (a file outside a repository, a missing path) opens nothing.
export async function folderToOpen(path: string): Promise<string | null> {
  const kind = await kindOf(path)
  if (kind === 'directory') {
    return (await findRepoRootUpwards(path)) ?? path
  }
  if (kind === 'file') {
    return findRepoRootUpwards(dirname(path))
  }
  return null
}

export interface FoldersToOpen {
  // In the order given, each once.
  folders: string[]
  // The paths that open nothing.
  unusable: string[]
}

export async function foldersToOpen(paths: readonly string[]): Promise<FoldersToOpen> {
  const resolved = await Promise.all(
    paths.map(async (path) => [path, await folderToOpen(path)] as const),
  )
  return {
    folders: [...new Set(resolved.flatMap(([, folder]) => (folder ? [folder] : [])))],
    unusable: resolved.flatMap(([path, folder]) => (folder ? [] : [path])),
  }
}
