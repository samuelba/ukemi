export const RESTORE_REPOSITORIES = 'desktop.restoreRepositories'

// The windows to open at startup, each as its list of repository folders. Folders from the
// command line win. Otherwise the last session's windows come back when the setting allows,
// minus folders that are gone. With nothing to open, one empty window shows the start page.
export function startupWindows(
  fromArgs: readonly string[],
  remembered: readonly (readonly string[])[],
  restore: boolean,
  exists: (folder: string) => boolean,
): string[][] {
  if (fromArgs.length > 0) {
    return [[...fromArgs]]
  }
  const restored = restore
    ? remembered.map((folders) => folders.filter(exists)).filter((folders) => folders.length > 0)
    : []
  return restored.length > 0 ? restored : [[]]
}

// The windows to remember after a window opened, closed or changed its tabs. Undefined keeps the
// list as it is: closing the last window ends the session, and that window should come back.
export function windowsToRemember(open: readonly (readonly string[])[]): string[][] | undefined {
  if (open.length === 0) {
    return undefined
  }
  return open.filter((folders) => folders.length > 0).map((folders) => [...folders])
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
