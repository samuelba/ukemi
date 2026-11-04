import { isAbsolute, relative } from 'node:path'
import { sameFolder } from '../repo/workspaceItems'

export const RESTORE_REPOSITORIES = 'desktop.restoreRepositories'

// The windows to open at startup, each as its list of repository folders. Folders from the
// command line win. Otherwise the last session's windows come back when the setting allows,
// minus folders that are gone. With nothing to open, one empty window shows the start page.
export function startupWindows(
  fromArgs: readonly string[],
  remembered: readonly (readonly string[])[],
  restore: boolean,
  exists: (folder: string) => boolean,
  pinned: readonly string[] = [],
): string[][] {
  const restored = restore
    ? remembered.map((folders) => folders.filter(exists)).filter((folders) => folders.length > 0)
    : []
  const windows = fromArgs.length > 0 ? [[...fromArgs]] : restored.length > 0 ? restored : [[]]
  return withPinned(windows, pinned.filter(exists))
}

// Pinned repositories always open, in the first window, unless a window has them already.
function withPinned(windows: string[][], pinned: readonly string[]): string[][] {
  const isOpen = (root: string) =>
    windows.some((folders) => folders.some((folder) => folder === root || isInside(folder, root)))
  const missing = pinned.filter((root) => !isOpen(root))
  const [first = [], ...others] = windows
  return [[...first, ...missing], ...others]
}

// The windows to remember after a window opened, closed or changed its tabs. Undefined keeps the
// list as it is: closing the last window ends the session, and that window should come back.
export function windowsToRemember(open: readonly (readonly string[])[]): string[][] | undefined {
  if (open.length === 0) {
    return undefined
  }
  return open.filter((folders) => folders.length > 0).map((folders) => [...folders])
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}

export interface WindowContents {
  // The folders the window opened.
  folders: readonly string[]
  // The repositories it shows, also those found inside an opened folder.
  repos: readonly string[]
}

// The index of the window that already shows `root`, or -1. One repository in two windows would
// double its watchers, auto-fetch and snapshots, so it opens where it already is.
export function windowShowing(root: string, windows: readonly WindowContents[]): number {
  return windows.findIndex(
    (window) =>
      window.folders.some((folder) => sameFolder(folder, root)) ||
      window.repos.some((repo) => sameFolder(repo, root)),
  )
}

// A window's folders after one repository tab closed, so the tab stays closed on the next start.
// A folder can be the repository, lie inside it, or hold it among others it was scanned for. The
// last kind turns into the repositories it still shows, in its place.
export function foldersAfterClosing(
  folders: readonly string[],
  repoRoots: readonly string[],
  closed: string,
): string[] {
  const next = folders.flatMap((folder) => {
    if (folder === closed || isInside(closed, folder)) {
      return []
    }
    if (isInside(folder, closed)) {
      return repoRoots.filter((root) => root !== closed && isInside(folder, root))
    }
    return [folder]
  })
  return [...new Set(next)]
}

export const THEME = 'desktop.theme'
export type ThemeSource = 'system' | 'light' | 'dark'

// The theme the user picked. Anything else follows the system.
export function themeSource(value: unknown): ThemeSource {
  return value === 'light' || value === 'dark' ? value : 'system'
}

// The name of the installed .desktop file. A Linux desktop shows the window with the icon of the
// entry whose name matches the window's app id, which Electron takes from this name.
export function desktopFileName(env: Readonly<Record<string, string | undefined>>): string {
  return env.FLATPAK_ID ? `${env.FLATPAK_ID}.desktop` : 'ukemi.desktop'
}
