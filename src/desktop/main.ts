import { existsSync, statSync } from 'node:fs'
import { homedir, release } from 'node:os'
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  BrowserWindow,
  Menu,
  app,
  dialog,
  ipcMain,
  nativeTheme,
  net,
  protocol,
  safeStorage,
  shell,
  type Rectangle,
} from 'electron'
import { locateJj, versionText } from '../app/jjSetup'
import { affectsJj } from '../app/settingsEffects'
import type { Ui } from '../app/ui'
import type { AboutInfo, Fonts, LogLine, ZoomStep } from '../../shared/desktopProtocol'
import { aboutInfo } from './about'
import { downloadJj, MIN_JJ_VERSION, PINNED_RELEASE } from '../jj/binary'
import { findRepoRootUpwards } from '../repo/discovery'
import { errorMessage } from '../util/logger'
import { KeyValueFile } from './adapters/keyValueFile'
import { adoptLoginShellPath } from './adapters/loginShellPath'
import { SecretsFile } from './adapters/secretsFile'
import { SettingsFile } from './adapters/settingsFile'
import { TrustStore } from './adapters/trustStore'
import { RepoTabStore } from './adapters/repoTabStore'
import { RecentRepoStore } from './adapters/recentRepoStore'
import { TO_MAIN, type DesktopContext, type DesktopPaths, type Page } from './context'
import { fileLogger } from './fileLogger'
import { detectSystemFont, resolveFonts, type SystemFont } from './fonts'
import { LogBuffer } from './logBuffer'
import { appMenuTemplate, KEYBINDINGS, shortcutKeys } from './menus'
import { DesktopSession } from './session'
import {
  desktopFileName,
  RESTORE_REPOSITORIES,
  startupWindows,
  THEME,
  themeSource,
  windowsToRemember,
} from './startup'
import { readZoom, stepZoom, zoomPercent } from './zoom'

const SCHEME = 'ukemi'
const PAGE_HOST = 'app'
const OPEN_FOLDERS_KEY = 'openFolders'
const BOUNDS_KEY = 'windowBounds'
const ZOOM_KEY = 'zoomFactor'
const DEFAULT_BOUNDS = { width: 1280, height: 860 }
const isDevelopment = !app.isPackaged

// Unpackaged, Electron would keep the data in a folder named after itself. Tests run the app
// against their own settings, trust and secrets.
// The window's app id must match the .desktop file, or the desktop shows a generic icon.
if (process.platform === 'linux') {
  app.setDesktopName(desktopFileName(process.env))
}
const userDataOverride = process.env.UKEMI_USER_DATA && resolve(process.env.UKEMI_USER_DATA)
app.setName('Ukemi')
app.setPath('userData', userDataOverride ?? join(app.getPath('appData'), 'Ukemi'))
if (userDataOverride) {
  app.setPath('logs', join(userDataOverride, 'logs'))
}

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

function desktopPaths(): DesktopPaths {
  // main.js sits in dist/desktop. The other bundles sit one level up in dist.
  const dist = resolve(__dirname, '..')
  const userData = app.getPath('userData')
  return {
    dist,
    preload: join(__dirname, 'preload.js'),
    icon: join(dist, '..', 'resources', 'icon.png'),
    helper: (name) => join(dist.replace(/app\.asar(?=$|[\\/])/, 'app.asar.unpacked'), name),
    userData,
    log: join(app.getPath('logs'), 'ukemi.log'),
  }
}

// Serves only files inside dist, so a page cannot read anything else on disk.
function servedFile(dist: string, url: URL): string | null {
  const path = normalize(join(dist, decodeURIComponent(url.pathname)))
  const inside = relative(dist, path)
  if (inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside)) {
    return null
  }
  return existsSync(path) && statSync(path).isFile() ? path : null
}

// Folders from the command line, like `ukemi .` or `ukemi ~/src/repo`, resolved to repo roots.
async function foldersFromArgs(argv: readonly string[], cwd: string): Promise<string[]> {
  const args = argv.slice(app.isPackaged ? 1 : 2).filter((arg) => !arg.startsWith('-'))
  const folders = await Promise.all(
    args.map(async (arg) => {
      const path = resolve(cwd, arg)
      if (!existsSync(path) || !statSync(path).isDirectory()) {
        return null
      }
      return (await findRepoRootUpwards(path)) ?? path
    }),
  )
  return folders.filter((folder): folder is string => folder !== null)
}

class DesktopApp implements DesktopContext {
  readonly paths = desktopPaths()
  readonly logger = new LogBuffer(fileLogger(this.paths.log, isDevelopment))
  readonly settings = new SettingsFile(join(this.paths.userData, 'settings.json'), (problem) =>
    this.logger.warn(problem),
  )
  readonly state = new KeyValueFile(join(this.paths.userData, 'state.json'), (problem) =>
    this.logger.warn(problem),
  )
  readonly trust = new TrustStore(this.state)
  readonly repoTabs = new RepoTabStore(this.state)
  readonly recentRepos = new RecentRepoStore(this.state)
  readonly jj: { path: string | null; version: string | null } = { path: null, version: null }
  private systemFont: SystemFont | null = null
  readonly secrets: SecretsFile
  private readonly sessions = new Set<DesktopSession>()
  private warnedAboutKeychain = false
  private pendingLog: LogLine[] = []
  private logTimer: ReturnType<typeof setTimeout> | null = null
  private isQuitting = false

  constructor() {
    this.logger.onLine((line) => this.queueLog(line))
    this.secrets = new SecretsFile(join(this.paths.userData, 'secrets.json'), safeStorage, () =>
      this.warnKeychain(),
    )
  }

  async start(): Promise<void> {
    await adoptLoginShellPath(process.env)
    await this.findJj()
    this.systemFont = await detectSystemFont()
    this.applyTheme()
    // The native About panel of the macOS app menu. Help > About shows Ukemi's own dialog.
    const about = this.about()
    app.setAboutPanelOptions({
      applicationName: about.name,
      applicationVersion: about.version,
      copyright: about.copyright,
      website: about.website,
    })
    this.settings.onDidChange((change) => {
      if (affectsJj(change)) {
        void this.reloadJj()
      }
      if (change.affects(KEYBINDINGS)) {
        this.installMenu()
      }
      if (change.affects(THEME)) {
        this.applyTheme()
        // The native About panel of the macOS app menu. Help > About shows Ukemi's own dialog.
        const about = this.about()
        app.setAboutPanelOptions({
          applicationName: about.name,
          applicationVersion: about.version,
          copyright: about.copyright,
          website: about.website,
        })
      }
    })
    this.serveFiles()
    this.routeMessages()
    this.installMenu()
    this.recentRepos.onDidChange(() => this.installMenu())
    const fromArgs = await foldersFromArgs(process.argv, process.cwd())
    const windows = startupWindows(
      fromArgs,
      this.state.get<string[][]>(OPEN_FOLDERS_KEY) ?? [],
      this.settings.values()[RESTORE_REPOSITORIES] !== false,
      (folder) => existsSync(folder),
      this.repoTabs.read().pinned,
    )
    for (const folders of windows) {
      this.openWindow(folders)
    }
    app.on('second-instance', (_event, argv, cwd) => void this.openFromSecondInstance(argv, cwd))
    app.on('activate', () => {
      if (this.sessions.size === 0) {
        this.openWindow([])
      }
    })
    app.on('before-quit', () => {
      this.isQuitting = true
      this.rememberOpenFolders()
    })
  }

  about(): AboutInfo {
    return aboutInfo(this.jj, {
      versions: process.versions,
      platform: process.platform,
      arch: process.arch,
      release: release(),
      userData: this.paths.userData,
    })
  }

  fonts(): Fonts {
    return resolveFonts(this.settings.values(), this.systemFont)
  }

  pageUrl(page: Page): string {
    return `${SCHEME}://${PAGE_HOST}/desktop/${page}.html`
  }

  backgroundColor(): string {
    return nativeTheme.shouldUseDarkColors ? '#1c1b19' : '#f7f3ec'
  }

  zoomFactor(): number {
    return readZoom(this.state.get<unknown>(ZOOM_KEY))
  }

  zoom(step: ZoomStep): void {
    const before = this.zoomFactor()
    const after = stepZoom(before, step)
    if (after === before) {
      return
    }
    void this.state.update(ZOOM_KEY, after === 1 ? undefined : after)
    for (const session of this.sessions) {
      session.setZoom(after)
    }
    // The menu shows the zoom in the label of Reset Zoom.
    this.installMenu()
  }

  windowBounds(): { width: number; height: number } {
    const saved = this.state.get<{ width?: unknown; height?: unknown }>(BOUNDS_KEY)
    return typeof saved?.width === 'number' && typeof saved.height === 'number'
      ? { width: saved.width, height: saved.height }
      : DEFAULT_BOUNDS
  }

  saveWindowBounds(bounds: Rectangle): void {
    void this.state.update(BOUNDS_KEY, { width: bounds.width, height: bounds.height })
  }

  // Pages never navigate away or open windows. Links go to the browser.
  guardNavigation(window: BrowserWindow): void {
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) {
        void shell.openExternal(url)
      }
      return { action: 'deny' }
    })
  }

  openWindow(folders: string[]): void {
    const open = [...this.sessions].find(
      (session) =>
        folders.length > 0 &&
        session.folders.length === folders.length &&
        folders.every((folder) => session.folders.includes(folder)),
    )
    if (open) {
      open.focus()
      return
    }
    this.sessions.add(new DesktopSession(this, folders))
    this.rememberOpenFolders()
  }

  closeSession(session: DesktopSession): void {
    // Quitting keeps the list, so the windows come back on the next start.
    if (!this.isQuitting) {
      this.sessions.delete(session)
      this.rememberOpenFolders()
    }
    session.dispose()
  }

  foldersChanged(): void {
    this.rememberOpenFolders()
  }

  openSettingsFile(): void {
    this.settings.ensureFile()
    void shell.openPath(this.settings.path).then((problem) => {
      if (problem) {
        this.logger.warn(`opening the settings file failed: ${problem}`)
        shell.showItemInFolder(this.settings.path)
      }
    })
  }

  openLogFile(): void {
    void shell.openPath(this.paths.log)
  }

  broadcastLog(): void {
    const lines = this.logger.recent()
    for (const session of this.sessions) {
      session.postLog(lines, true)
    }
  }

  async installJj(ui: Ui): Promise<void> {
    try {
      const path = await ui.progress(`Downloading jj ${PINNED_RELEASE.version}`, () =>
        downloadJj(this.paths.userData),
      )
      this.logger.info(`installed jj to ${path}`)
      await this.reloadJj()
    } catch (error: unknown) {
      void ui.error(`Ukemi: jj download failed: ${errorMessage(error)}`)
    }
  }

  // Every page follows prefers-color-scheme, which Electron derives from the theme source.
  private applyTheme(): void {
    nativeTheme.themeSource = themeSource(this.settings.values()[THEME])
  }

  // Finds jj again and hands it to every window, which rediscovers its repositories.
  private async reloadJj(): Promise<void> {
    await this.findJj()
    for (const session of this.sessions) {
      if (this.jj.path) {
        session.useJj(this.jj.path)
      }
    }
  }

  private async findJj(): Promise<void> {
    const found = await locateJj(this.settings.read().jjPath, this.paths.userData, this.logger)
    this.jj.path = found?.path ?? null
    this.jj.version = found ? versionText(found.version) : null
    if (!found) {
      const { major, minor } = MIN_JJ_VERSION
      this.logger.warn(`no jj ${major}.${minor} or newer found`)
    }
  }

  private serveFiles(): void {
    protocol.handle(SCHEME, (request) => {
      const url = new URL(request.url)
      const path = url.host === PAGE_HOST ? servedFile(this.paths.dist, url) : null
      return path
        ? net.fetch(pathToFileURL(path).toString())
        : new Response('Not found', { status: 404 })
    })
  }

  // Sends new log lines to the windows in batches, so a burst of jj calls is one message.
  private queueLog(line: LogLine): void {
    this.pendingLog.push(line)
    if (this.logTimer) {
      return
    }
    this.logTimer = setTimeout(() => {
      this.logTimer = null
      const lines = this.pendingLog
      this.pendingLog = []
      for (const session of this.sessions) {
        session.postLog(lines, false)
      }
    }, 100)
  }

  private routeMessages(): void {
    ipcMain.on(TO_MAIN, (event, message: unknown) => {
      const id = event.sender.id
      const session = [...this.sessions].find((s) => s.webContentsId === id)
      void session?.receive(message)
    })
  }

  private focusedSession(): DesktopSession | undefined {
    const focused = BrowserWindow.getFocusedWindow()
    const sessions = [...this.sessions]
    return (
      sessions.find((s) => s.window === focused) ??
      sessions.find((s) => s.window === focused?.getParentWindow()) ??
      sessions[0]
    )
  }

  private installMenu(): void {
    const template = appMenuTemplate({
      run: (command, arg) => void this.focusedSession()?.run(command, arg),
      shell: (action) => this.focusedSession()?.shell(action),
      openRepository: () => {
        const session = this.focusedSession()
        if (session) {
          void session.receive({ type: 'desktop.openRepo' })
        } else {
          this.openWindow([])
        }
      },
      recent: { roots: this.recentRepos.read(), home: homedir() },
      openRecent: (root) => void this.openRecent(root),
      clearRecent: () => void this.recentRepos.clear(),
      zoom: { percent: zoomPercent(this.zoomFactor()), step: (step) => this.zoom(step) },
      keys: shortcutKeys(this.settings.values()[KEYBINDINGS]),
      newWindow: () => this.openWindow([]),
      openSettings: () => this.focusedSession()?.showSettings(),
      openKeyboardShortcuts: () => this.focusedSession()?.showSettings('keyboardShortcuts'),
      openLog: () => this.focusedSession()?.shell('showLog'),
      about: () => this.focusedSession()?.showAbout(),
      openExternal: (url) => void shell.openExternal(url),
      isDevelopment,
    })
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  // Opens a repository of File > Open Recent as a tab of the focused window.
  private async openRecent(root: string): Promise<void> {
    if (!existsSync(root)) {
      await this.recentRepos.forget(root)
      const options = {
        type: 'warning' as const,
        message: `${root} no longer exists.`,
        detail: 'It was removed from the recent repositories.',
      }
      const parent = this.focusedSession()?.window
      await (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options))
      return
    }
    const session = this.focusedSession()
    if (session) {
      session.focus()
      await session.addFolder(root)
    } else {
      this.openWindow([root])
    }
  }

  private async openFromSecondInstance(argv: readonly string[], cwd: string): Promise<void> {
    const folders = await foldersFromArgs(argv, cwd)
    if (folders.length > 0) {
      this.openWindow(folders)
      return
    }
    this.focusedSession()?.focus()
  }

  private rememberOpenFolders(): void {
    const open = windowsToRemember([...this.sessions].map((session) => session.folders))
    if (open) {
      void this.state.update(OPEN_FOLDERS_KEY, open)
    }
  }

  private warnKeychain(): void {
    if (this.warnedAboutKeychain) {
      return
    }
    this.warnedAboutKeychain = true
    this.logger.warn('no OS keychain is available, so sign-ins last only until the app quits')
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void app.whenReady().then(async () => {
    const desktop = new DesktopApp()
    try {
      await desktop.start()
    } catch (error: unknown) {
      desktop.logger.error(`startup failed: ${errorMessage(error)}`)
      throw error
    }
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
