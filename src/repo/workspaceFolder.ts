import { existsSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { removableWorkspaceFolder } from './cleanupItems'

// The workspace made by `jj git init` or `jj git clone` keeps the repository in .jj/repo. In the
// other workspaces that is a file pointing at it. Deleting the first folder deletes the history of
// every workspace, even when another workspace is the one open.
export function holdsRepositoryStore(root: string): boolean {
  try {
    return statSync(join(root, '.jj', 'repo')).isDirectory()
  } catch {
    return false
  }
}

export function canDeleteWorkspaceFolder(repoRoot: string, root: string | null): boolean {
  const target = removableWorkspaceFolder(repoRoot, root)
  return target !== null && existsSync(target) && !holdsRepositoryStore(target)
}

// Returns whether the folder was deleted.
export async function deleteWorkspaceFolder(repoRoot: string, root: string): Promise<boolean> {
  if (!canDeleteWorkspaceFolder(repoRoot, root)) {
    return false
  }
  await rm(root, { recursive: true, force: true })
  return true
}
