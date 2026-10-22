import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export type RepoKind = 'jj' | 'git'

export interface DiscoveredRepo {
  root: string
  kind: RepoKind
}

export interface DiscoveryOptions {
  maxDepth: number
  exclude: readonly string[]
}

export const DEFAULT_EXCLUDES = [
  'node_modules',
  'build',
  'install',
  'log',
  'dist',
  'out',
  'target',
  'venv',
  '.venv',
  '__pycache__',
]

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function repoKindAt(dir: string): Promise<RepoKind | null> {
  if (await isDirectory(join(dir, '.jj'))) {
    return 'jj'
  }
  if (await exists(join(dir, '.git'))) {
    return 'git'
  }
  return null
}

export async function findRepoRootUpwards(start: string): Promise<string | null> {
  let dir = start
  for (;;) {
    if (await isDirectory(join(dir, '.jj'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) {
      return null
    }
    dir = parent
  }
}

async function listSubdirectories(dir: string, exclude: ReadonlySet<string>): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !exclude.has(e.name))
    .map((e) => join(dir, e.name))
    .sort()
}

export async function discoverRepos(
  folder: string,
  options: DiscoveryOptions,
): Promise<DiscoveredRepo[]> {
  const enclosing = await findRepoRootUpwards(folder)
  if (enclosing) {
    return [{ root: enclosing, kind: 'jj' }]
  }
  if (await exists(join(folder, '.git'))) {
    return [{ root: folder, kind: 'git' }]
  }

  const exclude = new Set(options.exclude)
  const found: DiscoveredRepo[] = []
  let level = await listSubdirectories(folder, exclude)
  for (let depth = 1; depth <= options.maxDepth && level.length > 0; depth++) {
    const next: string[] = []
    for (const dir of level) {
      const kind = await repoKindAt(dir)
      if (kind) {
        found.push({ root: dir, kind })
      } else if (depth < options.maxDepth) {
        next.push(...(await listSubdirectories(dir, exclude)))
      }
    }
    level = next
  }
  return found.sort((a, b) => a.root.localeCompare(b.root))
}
