import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { bookmarkRevision } from '../jj/revsets'
import type { Workspace } from '../../shared/model'

export interface BookmarkRef {
  name: string
  remote?: string
  commitId: string
}

export interface CommitBookmarks {
  commitId: string
  localBookmarks: readonly { name: string }[]
  remoteBookmarks: readonly { name: string; remote: string }[]
}

export interface WorkspaceBaseItem {
  label: string
  description?: string
  revision: string
  suggestedName: string
  shown: string
}

export interface WorkspaceTreeElement {
  kind: 'workspace'
  repoId: string
  workspace: Workspace
  isCurrent: boolean
  isOpen: boolean
}

export type WorkspaceNesting = 'inside' | 'contains'

interface NameSource {
  changeId: string
  changePrefix: string
  localBookmarks: readonly { name: string }[]
}

export function sameFolder(left: string, right: string): boolean {
  return resolve(left) === resolve(right)
}

export function isCurrentWorkspace(workspace: Workspace, repoRoot: string): boolean {
  return workspace.root !== null && sameFolder(workspace.root, repoRoot)
}

export function isWorkspaceOpen(root: string, folders: readonly string[]): boolean {
  return folders.some((folder) => sameFolder(folder, root))
}

export function workspaceNesting(
  root: string,
  folders: readonly string[],
): WorkspaceNesting | null {
  const target = resolve(root)
  for (const folder of folders) {
    const open = resolve(folder)
    if (open === target) {
      continue
    }
    if (isInside(open, target)) {
      return 'inside'
    }
    if (isInside(target, open)) {
      return 'contains'
    }
  }
  return null
}

export function workspaceItemLabel(name: string, isCurrent: boolean): string {
  return isCurrent ? `${name} (current)` : name
}

export function workspaceItemDescription(workspace: Workspace): string {
  if (workspace.isEmpty) {
    return '(empty)'
  }
  const line = workspace.description.trim()
  return line.length > 0 ? `${workspace.changeId} ${line}` : workspace.changeId
}

export function workspaceTooltipLines(workspace: Workspace): string[] {
  const files =
    workspace.changedFiles === 1 ? '1 changed file' : `${workspace.changedFiles} changed files`
  return [workspace.root ?? 'No working copy on disk', workspace.commitId, files]
}

export function workspaceContextValue(options: {
  isCurrent: boolean
  isOpen: boolean
  isDefault: boolean
  hasRoot: boolean
}): string {
  const flags = ['workspace']
  if (options.isDefault) {
    flags.push('default')
  }
  if (options.isCurrent) {
    flags.push('current')
  }
  if (options.isOpen) {
    flags.push('open')
  }
  if (!options.hasRoot) {
    flags.push('missing')
  }
  return flags.join('+')
}

export function compareWorkspaces(left: WorkspaceTreeElement, right: WorkspaceTreeElement): number {
  if (left.isCurrent !== right.isCurrent) {
    return left.isCurrent ? -1 : 1
  }
  return left.workspace.name.localeCompare(right.workspace.name)
}

export function isWorkspaceTreeElement(arg: unknown): arg is WorkspaceTreeElement {
  if (typeof arg !== 'object' || arg === null) {
    return false
  }
  const value = arg as { kind?: unknown; repoId?: unknown; workspace?: { name?: unknown } }
  return (
    value.kind === 'workspace' &&
    typeof value.repoId === 'string' &&
    typeof value.workspace?.name === 'string'
  )
}

export function defaultWorkspaceName(base: string): string {
  const remote = /^([^@\s()]+)@([^@\s()]+)$/.exec(base)
  if (remote?.[1]) {
    return remote[1]
  }
  if (/^[0-9a-f]{8,}$/i.test(base)) {
    return base.slice(0, 8)
  }
  if (base === '@' || base === 'trunk()' || /[()\s]/.test(base)) {
    return ''
  }
  return base
}

export function suggestedWorkspaceName(base: string, commit?: NameSource): string {
  const bookmark = commit?.localBookmarks.find((item) => item.name.length > 0)?.name
  if (bookmark) {
    return bookmark
  }
  if (commit) {
    return commit.changeId.slice(0, Math.max(8, commit.changePrefix.length))
  }
  return defaultWorkspaceName(base)
}

export interface BookmarkRefs {
  local: BookmarkRef[]
  remote: BookmarkRef[]
}

// Keeps the first ref for each local name and each name@remote pair.
export function uniqueBookmarkRefs(refs: Iterable<BookmarkRef>): BookmarkRefs {
  const localSeen = new Set<string>()
  const remoteSeen = new Set<string>()
  const local: BookmarkRef[] = []
  const remote: BookmarkRef[] = []
  for (const ref of refs) {
    if (ref.remote === undefined) {
      if (!localSeen.has(ref.name)) {
        localSeen.add(ref.name)
        local.push(ref)
      }
      continue
    }
    const key = `${ref.name}@${ref.remote}`
    if (!remoteSeen.has(key)) {
      remoteSeen.add(key)
      remote.push(ref)
    }
  }
  return { local, remote }
}

export function collectBookmarks(commits: readonly CommitBookmarks[]): BookmarkRefs {
  return uniqueBookmarkRefs(
    commits.flatMap((commit) => [
      ...commit.localBookmarks.map((bookmark) => ({
        name: bookmark.name,
        commitId: commit.commitId,
      })),
      ...commit.remoteBookmarks.map((bookmark) => ({
        name: bookmark.name,
        remote: bookmark.remote,
        commitId: commit.commitId,
      })),
    ]),
  )
}

export function workspaceBaseItems(
  graph: { trunkName: string | null; commits: readonly CommitBookmarks[] } | null,
): WorkspaceBaseItem[] {
  const items: WorkspaceBaseItem[] = []
  const trunk = graph?.trunkName
  if (trunk) {
    items.push({
      label: `$(git-branch) trunk (${trunk})`,
      description: 'trunk()',
      revision: 'trunk()',
      suggestedName: trunk,
      shown: `trunk (${trunk})`,
    })
  }
  items.push({
    label: '$(edit) @ (working copy)',
    revision: '@',
    suggestedName: '',
    shown: '@',
  })
  const { local, remote } = collectBookmarks(graph?.commits ?? [])
  for (const bookmark of local) {
    items.push({
      label: `$(bookmark) ${bookmark.name}`,
      revision: bookmarkRevision(bookmark.name),
      suggestedName: bookmark.name,
      shown: bookmark.name,
    })
  }
  for (const bookmark of remote) {
    const shown = `${bookmark.name}@${bookmark.remote}`
    items.push({
      label: `$(cloud) ${shown}`,
      revision: bookmarkRevision(bookmark.name, bookmark.remote),
      suggestedName: bookmark.name,
      shown,
    })
  }
  return items
}

// The folder new workspaces go in. An empty location is the repository's parent folder, `~` is
// the home folder, and a relative path starts at the repository root.
export function workspaceParent(repoRoot: string, location: string, home: string): string {
  const trimmed = location.trim()
  if (trimmed.length === 0) {
    return dirname(resolve(repoRoot))
  }
  if (trimmed === '~') {
    return resolve(home)
  }
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return resolve(home, trimmed.slice(2))
  }
  return resolve(repoRoot, trimmed)
}

export function workspaceFolder(parent: string, repoRoot: string, name: string): string {
  return join(parent, `${basename(resolve(repoRoot))}-${name}`)
}

// The --colocate choice for `workspace add`: undefined lets jj decide. It applies only to a
// colocated repository and a jj that has the flag.
export function workspaceColocation(
  mode: 'auto' | 'always' | 'never',
  isColocated: boolean,
  canColocate: boolean,
): boolean | undefined {
  if (mode === 'auto' || !isColocated || !canColocate) {
    return undefined
  }
  return mode === 'always'
}

// A workspace in the repository's folder would have its files tracked by the outer working copy.
export function isInsideRepository(folder: string, repoRoot: string): boolean {
  return sameFolder(folder, repoRoot) || isInside(resolve(repoRoot), resolve(folder))
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}
