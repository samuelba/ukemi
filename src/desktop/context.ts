import type { BrowserWindow } from 'electron'
import type { AboutInfo, Fonts, ZoomStep } from '../../shared/desktopProtocol'
import type { Ui } from '../app/ui'
import type { KeyValueFile } from './adapters/keyValueFile'
import type { LoopbackServer } from './adapters/loopbackRedirect'
import type { SecretsFile } from './adapters/secretsFile'
import type { SettingsFile } from './adapters/settingsFile'
import type { TrustStore } from './adapters/trustStore'
import type { RepoTabStore } from './adapters/repoTabStore'
import type { RecentRepoStore } from './adapters/recentRepoStore'
import type { LogBuffer } from './logBuffer'
import type { DesktopSession } from './session'
import type { WindowPlacement } from './windowBounds'

export const TO_RENDERER = 'ukemi:host'
export const TO_MAIN = 'ukemi:renderer'

export interface DesktopPaths {
  // The bundled output: main.js, askpass.js, splitTool.js and the pages.
  dist: string
  preload: string
  userData: string
  log: string
  // The window icon on X11 and Windows. Wayland takes the icon of the .desktop file.
  icon: string
  // A helper script that git or jj runs with the app in Node mode. Packaged, it sits outside the
  // asar archive, since another process reads it by path.
  helper(name: 'askpass.js' | 'splitTool.js'): string
}

export type Page = 'desktop'

// What the app shares between its windows.
export interface DesktopContext {
  readonly paths: DesktopPaths
  readonly logger: LogBuffer
  readonly settings: SettingsFile
  readonly secrets: SecretsFile
  readonly state: KeyValueFile
  readonly trust: TrustStore
  readonly repoTabs: RepoTabStore
  readonly recentRepos: RecentRepoStore
  // The one local server that receives GitLab sign-in redirects for every window.
  readonly loopback: LoopbackServer
  readonly jj: { path: string | null; version: string | null }
  about(): AboutInfo
  // The fonts of diffs and terminals, from the settings and the system.
  fonts(): Fonts
  pageUrl(page: Page): string
  backgroundColor(): string
  // The size, place and maximized state of the window that last moved.
  windowBounds(): WindowPlacement
  saveWindowBounds(placement: WindowPlacement): void
  guardNavigation(window: BrowserWindow): void
  openWindow(folders: string[]): void
  // Another window that already shows the repository at `root`.
  windowShowing(root: string, except?: DesktopSession): DesktopSession | undefined
  // The zoom factor of every window, and a change of it from the menu, a key or the status bar.
  zoomFactor(): number
  zoom(step: ZoomStep): void
  closeSession(session: DesktopSession): void
  // A window opened or closed a repository tab.
  foldersChanged(): void
  openSettingsFile(): void
  // Sends the whole log again to every window, as after clearing it.
  broadcastLog(): void
  openLogFile(): void
  installJj(ui: Ui): Promise<void>
}
