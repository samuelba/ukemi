import { homedir } from 'node:os'
import { basename } from 'node:path'
import { Menu, clipboard, dialog, shell, type BrowserWindow } from 'electron'
import type {
  LogLine,
  SidePanelRow,
  DesktopRendererMessage,
  ShellAction,
  ShellInbound,
} from '../../shared/desktopProtocol'
import { isDesktopMessage } from '../../shared/desktopProtocol'
import type { MenuEntry } from '../../shared/menus'
import type { WebviewMessage } from '../../shared/protocol'
import { answerPrompt } from '../app/askpassPrompts'
import { AutoFetcher } from '../app/autoFetch'
import { ChangeSelection } from '../app/changeSelection'
import { commitCommands } from '../app/commands/commitCommands'
import type { CommandEnv, Handler } from '../app/commands/context'
import { evolutionCommands } from '../app/commands/evolutionCommands'
import { operationCommands } from '../app/commands/operationCommands'
import { fileHistoryCommands } from '../app/commands/fileHistoryCommands'
import { fileCommands } from '../app/commands/fileCommands'
import { globalCommands } from '../app/commands/globalCommands'
import { bookmarkCommands } from '../app/commands/bookmarkCommands'
import { requestCommands } from '../app/commands/requestCommands'
import { workspaceCommands } from '../app/commands/workspaceCommands'
import { Emitter, disposeAll, type Disposable } from '../app/events'
import { ForgeService } from '../app/forgeService'
import type { FolderSource, Host, WindowState } from '../app/host'
import { createMessageHandler } from '../app/messages'
import { Operations } from '../app/operations'
import { RepoRegistry } from '../app/registry'
import { watchRepositorySettings } from '../app/settingsEffects'
import { sidePanels } from '../app/sidePanels'
import { buildViewState } from '../app/viewState'
import { AskpassServer } from '../askpass/server'
import { JjRunner } from '../jj/runner'
import { errorMessage, type Logger } from '../util/logger'
import { RendererUi, type NativeUi } from './adapters/rendererUi'
import { fsWatchRepo } from './adapters/watchRepo'
import { windowStore } from './adapters/windowStore'
import { arrangeTabs, move, pin, rename, unpin } from './repoTabs'
import { TO_RENDERER, type DesktopContext } from './context'
import {
  graphTitleMenu,
  menuTemplate,
  paletteCommands,
  treeItemActions,
  treeItemMenu,
  webviewMenu,
} from './menus'
import { aboutText } from './about'
import { DetailPresenter } from './detailPresenter'
import { droppedPaths, foldersToOpen } from './openPaths'
import { PanelTabs } from './panelTabs'
import { createSessionWindow } from './sessionWindow'
import { SettingsPresenter } from './settingsPresenter'
import { foldersAfterClosing, windowShowing, type WindowContents } from './startup'
import { Terminals } from './terminals'
import { zoomPercent } from './zoom'
import { desktopWorkbench } from './workbench'
import { cliSuggesters, DescriptionSuggestions } from '../app/describeSuggest/service'

const COMMAND_ID = /^ukemi\.[\w.]+$/
const STATE_DEBOUNCE_MS = 16

const UNTRUSTED_MESSAGE =
  'Ukemi: trust this repository to sign in to a forge. Reopen it and choose Trust.'

const TRUST_DETAIL =
  'Ukemi only signs in to GitHub or GitLab, hands stored credentials to git, and fetches in the background in repositories you trust. A repository chooses which servers its remotes point to, and its git config can run commands when git fetches.'

function isMessage(value: unknown): value is { type: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// One window of the app: its folders, its repositories and every service behind its graph.
export class DesktopSession implements Disposable {
  readonly window: BrowserWindow
  private readonly folderList: string[]
  private readonly folderEmitter = new Emitter<void>()
  private readonly focusEmitter = new Emitter<void>()
  private readonly trustEmitter = new Emitter<void>()
  private readonly ui: RendererUi
  private readonly terminals: Terminals
  private readonly runner: JjRunner
  private readonly askpass: AskpassServer
  private readonly registry: RepoRegistry
  private readonly operations: Operations
  private readonly selection = new ChangeSelection()
  private readonly forge: ForgeService
  private readonly autoFetch: AutoFetcher
  private readonly env: CommandEnv
  private readonly handlers: Record<string, Handler>
  private readonly handleWebview: (message: WebviewMessage) => Promise<void>
  private readonly panelTabs: PanelTabs
  private readonly detail: DetailPresenter
  private readonly settingsForm: SettingsPresenter
  private readonly disposables: Disposable[] = []
  private isReady = false
  // The page crashed and loaded again, so its terminals need tabs again once it is ready.
  private needsReattach = false
  private isClosed = false
  // Native dialogs need a mapped parent. On Wayland, a dialog on a hidden window kills the app.
  private readonly shown: Promise<void>
  private stateTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly context: DesktopContext,
    folders: readonly string[],
  ) {
    this.folderList = [...new Set(folders)]
    const logger = context.logger
    this.ui = new RendererUi((message) => this.post(message), this.nativeUi())
    this.terminals = new Terminals((message) => this.post(message), logger)
    this.panelTabs = new PanelTabs((message) => this.post(message), logger)
    this.runner = new JjRunner(context.jj.path ?? 'jj', logger)
    this.runner.onWarning((warning) => void this.ui.warn(`jj: ${warning.text}`))
    this.askpass = new AskpassServer(
      process.execPath,
      [context.paths.helper('askpass.js')],
      (request) => this.runner.whilePrompting(() => this.forge.gitCredential(request)),
      (request) => this.runner.whilePrompting(() => answerPrompt(this.ui, request)),
    )

    const host = this.host()
    this.registry = new RepoRegistry(this.runner, logger, host)
    this.operations = new Operations(logger)
    this.forge = new ForgeService(this.registry, host, logger, {
      githubSession: null,
      gitlabRedirect: context.loopback.redirect(),
      untrustedMessage: UNTRUSTED_MESSAGE,
    })
    this.autoFetch = new AutoFetcher(this.registry, this.forge, this.operations, logger, host)
    this.detail = new DetailPresenter({
      activeModel: () => this.registry.activeModel,
      changeIdLength: () => context.settings.read().changeIdLength,
      post: (detail) => this.post({ type: 'desktop.detail', detail }),
      withActions: (row) => this.withActions(row),
      logger,
    })
    this.settingsForm = new SettingsPresenter({
      settings: context.settings,
      repos: () => this.registry.summaries(),
      activeRoot: () => this.registry.activeModel?.root ?? null,
      post: (message) => this.post(message),
      confirm: async (text, detail, action) =>
        (await this.nativeUi().ask('warning', text, detail, [action])) === action,
      logger,
    })
    this.env = this.commandEnv(host)
    this.handlers = this.commandHandlers()
    this.handleWebview = createMessageHandler(this.env, (command, arg) => this.run(command, arg))
    this.disposables.push(
      this.terminals,
      this.registry,
      this.operations,
      this.selection,
      this.forge,
      this.autoFetch,
      this.askpass,
      // After the services above, so none of them starts jj again once its processes are ended.
      { dispose: () => this.runner.dispose() },
      this.registry.onDidChange(() => {
        this.scheduleState()
        const root = this.registry.activeModel?.root
        if (root) {
          void context.recentRepos.remember(root)
        }
        this.settingsForm.followActiveRepo()
      }),
      this.registry.onDidChangeModel(() => this.scheduleState()),
      this.operations.onDidChange(() => this.scheduleState()),
      this.autoFetch.onDidChange(() => this.scheduleState()),
      context.repoTabs.onDidChange(() => this.scheduleState()),
      context.settings.onDidChange(() => {
        this.scheduleState()
        this.settingsForm.post()
        this.post({ type: 'desktop.fonts', fonts: context.fonts() })
      }),
      watchRepositorySettings(context.settings, this.registry),
    )
    const created = createSessionWindow(context, {
      title: this.title(),
      onFocus: () => this.focusEmitter.fire(),
      onClosed: () => context.closeSession(this),
      beforeReload: () => this.pageReloading(),
      isClosed: () => this.isClosed,
    })
    this.window = created.window
    this.shown = created.shown
    void this.start(logger)
  }

  get folders(): readonly string[] {
    return this.folderList
  }

  get webContentsId(): number {
    return this.window.webContents.id
  }

  focus(): void {
    if (this.window.isMinimized()) {
      this.window.restore()
    }
    this.window.focus()
  }

  // Runs a command from the app menu, a context menu or the palette.
  run(command: string, arg?: unknown): Promise<void> {
    const handler = this.handlers[command]
    if (!COMMAND_ID.test(command) || !handler) {
      return Promise.resolve()
    }
    return Promise.resolve(handler(arg)).then(
      () => undefined,
      (error: unknown) => {
        this.context.logger.error(`${command} failed: ${errorMessage(error)}`)
        void this.ui.error(`Ukemi: ${errorMessage(error)}`)
      },
    )
  }

  offers(command: string): boolean {
    return command in this.handlers
  }

  shell(action: ShellAction): void {
    this.post({ type: 'desktop.action', action })
  }

  async receive(raw: unknown): Promise<void> {
    if (!isMessage(raw)) {
      return
    }
    try {
      if (isDesktopMessage(raw)) {
        await this.handleDesktop(raw as DesktopRendererMessage)
        return
      }
      const message = raw as WebviewMessage
      if (message.type === 'ready') {
        this.isReady = true
        this.sendInitial()
        if (this.needsReattach) {
          this.needsReattach = false
          this.terminals.reattach()
        }
        return
      }
      await this.handleWebview(message)
      if (message.type === 'selectCommit') {
        await this.detail.show(message.commitId)
      }
    } catch (error: unknown) {
      this.context.logger.error(`window message ${raw.type} failed: ${errorMessage(error)}`)
    }
  }

  // Opens a repository as a tab of this window and shows it. A repository open in another window
  // is shown there instead.
  async addFolder(root: string): Promise<void> {
    if (windowShowing(root, [this.contents()]) < 0) {
      const other = this.context.windowShowing(root, this)
      if (other) {
        await other.reveal(root)
        return
      }
      this.folderList.push(root)
      this.context.foldersChanged()
      this.window.setTitle(this.title())
      void this.askTrust()
      await this.registry.discover()
    }
    await this.showRepo(root)
  }

  // Opens what was dropped on the window as tabs, the last one active. Says what it could not open.
  private async openDropped(paths: readonly string[]): Promise<void> {
    const { folders, unusable } = await foldersToOpen(paths)
    for (const folder of folders) {
      await this.addFolder(folder)
    }
    if (unusable.length > 0) {
      const names = unusable.map((path) => basename(path) || path).join(', ')
      void this.ui.warn(`Could not open ${names}. Drop a folder, or a file inside a repository.`)
    }
  }

  // Brings the window to the front with the repository at `root` as its active tab.
  async reveal(root: string): Promise<void> {
    this.focus()
    await this.showRepo(root)
  }

  contents(): WindowContents {
    return {
      folders: this.folderList,
      repos: this.registry.summaries().map((summary) => summary.id),
    }
  }

  private async showRepo(root: string): Promise<void> {
    const repo = this.registry
      .summaries()
      .find((summary) => summary.id === root || summary.id.startsWith(`${root}/`))
    if (repo) {
      await this.registry.setActive(repo.id)
    }
  }

  // Closes a repository tab, also one found inside an open folder, and remembers it closed.
  async closeRepo(repoId: string): Promise<void> {
    const roots = this.registry.summaries().map((summary) => summary.id)
    const next = foldersAfterClosing(this.folderList, roots, repoId)
    this.folderList.splice(0, this.folderList.length, ...next)
    this.context.foldersChanged()
    this.window.setTitle(this.title())
    await this.registry.discover()
    this.scheduleState()
  }

  // Shows the settings form, or its keyboard shortcuts.
  showSettings(action: 'settings' | 'keyboardShortcuts' = 'settings'): void {
    this.settingsForm.post()
    this.shell(action)
  }

  async showRepositorySettings(root: string): Promise<void> {
    if (this.registry.activeModel?.root !== root) {
      await this.registry.setActive(root)
    }
    this.settingsForm.post()
    this.shell('repositorySettings')
  }

  showAbout(): void {
    const info = this.context.about()
    this.post({ type: 'desktop.about', info, text: aboutText(info) })
  }

  setZoom(factor: number): void {
    this.window.webContents.setZoomFactor(factor)
    this.post({ type: 'desktop.zoom', percent: zoomPercent(factor) })
  }

  postLog(lines: LogLine[], replace: boolean): void {
    this.post({ type: 'desktop.log', lines, replace })
  }

  useJj(path: string): void {
    this.runner.useBinary(path)
    void this.registry.discover().then(() => this.scheduleState())
  }

  dispose(): void {
    if (this.isClosed) {
      return
    }
    this.isClosed = true
    if (this.stateTimer) {
      clearTimeout(this.stateTimer)
    }
    this.ui.cancelAll()
    this.panelTabs.closeAll()
    disposeAll(this.disposables)
    this.folderEmitter.dispose()
    this.focusEmitter.dispose()
    this.trustEmitter.dispose()
  }

  private async start(logger: Logger): Promise<void> {
    try {
      await this.askpass.start()
      this.runner.setEnvironment(this.askpass.env)
    } catch (error: unknown) {
      logger.warn(`git sign-in over HTTPS is not available: ${errorMessage(error)}`)
    }
    await this.registry.discover()
    this.scheduleState()
    void this.askTrust()
  }

  private commandEnv(host: Host): CommandEnv {
    const context = this.context
    return {
      registry: this.registry,
      operations: this.operations,
      graphView: {
        isVisible: true,
        post: (message) => this.post(message),
        showCommit: async (commitId) => {
          this.focus()
          this.post({ type: 'reveal', commitId })
        },
      },
      forge: this.forge,
      runner: this.runner,
      logger: context.logger,
      selection: this.selection,
      autoFetch: this.autoFetch,
      ui: this.ui,
      settings: context.settings,
      folders: host.folders,
      workbench: desktopWorkbench(
        {
          post: (message) => this.post(message),
          openPanelWindow: (entry, title, connect, key) =>
            this.panelTabs.open(entry, title, connect, key),
          openWindow: (root) => void this.addFolder(root),
          addFolder: (root) => void this.addFolder(root),
          hasFolders: () => false,
          openSettings: () => this.showSettings(),
          openRepositorySettings: (root) => this.showRepositorySettings(root),
          openTerminal: (cwd, name) => this.terminals.open(cwd, name),
          openPath: async (fsPath) => {
            const problem = await shell.openPath(fsPath)
            if (problem) {
              void this.ui.error(`Ukemi: could not open ${fsPath}: ${problem}`)
            }
          },
          installJj: () => context.installJj(this.ui),
          splitPaths: {
            storageDir: context.paths.userData,
            toolPath: context.paths.helper('splitTool.js'),
          },
        },
        () => this.env,
      ),
      suggestions: new DescriptionSuggestions(cliSuggesters(context.settings), context.settings),
    }
  }

  // The crashed page took its prompts and Split or Clean up tabs with it. Their state lived there,
  // so they close. The graph and the details are sent again when the new page is ready.
  private pageReloading(): void {
    this.isReady = false
    this.needsReattach = true
    this.ui.cancelAll()
    this.panelTabs.closeAll()
  }

  private title(): string {
    const names = this.folderList.map((folder) => basename(folder))
    return names.length > 0 ? `${names.join(', ')} — Ukemi` : 'Ukemi'
  }

  private host(): Host {
    const folderList = this.folderList
    const context = this.context
    const isFocused = () => !this.isClosed && this.window.isFocused()
    const folders: FolderSource = {
      folders: () => folderList.map((path) => ({ name: basename(path), path })),
      // The session rediscovers itself when it opens or closes a tab, to pick the new repository.
      onDidChangeFolders: this.folderEmitter.event,
      activeFile: () => undefined,
      onDidChangeActiveFile: () => ({ dispose: () => undefined }),
    }
    const windowState: WindowState = {
      get isFocused() {
        return isFocused()
      },
      onDidFocus: this.focusEmitter.event,
      get isTrusted() {
        return folderList.every((folder) => context.trust.isTrusted(folder))
      },
      onDidGrantTrust: this.trustEmitter.event,
    }
    return {
      ui: this.ui,
      settings: context.settings,
      window: windowState,
      folders,
      watchRepo: fsWatchRepo(context.logger),
      store: windowStore(context.state.scoped('window')),
      secrets: context.secrets,
    }
  }

  private nativeUi(): NativeUi {
    return {
      ask: async (level, text, detail, actions) => {
        await this.shown
        if (this.isClosed) {
          return undefined
        }
        const buttons = [...actions, 'Cancel']
        const { response } = await dialog.showMessageBox(this.window, {
          type: level === 'info' ? 'info' : 'warning',
          message: text.replace(/^Ukemi: /, ''),
          detail,
          buttons,
          defaultId: 0,
          cancelId: buttons.length - 1,
          noLink: true,
        })
        return actions[response]
      },
      pickFolder: async (openLabel) => {
        await this.shown
        if (this.isClosed) {
          return undefined
        }
        const picked = await dialog.showOpenDialog(this.window, {
          buttonLabel: openLabel,
          properties: ['openDirectory', 'createDirectory'],
        })
        return picked.canceled ? undefined : picked.filePaths[0]
      },
      openExternal: async (url) => {
        await shell.openExternal(url)
        return true
      },
      copy: (text) => clipboard.writeText(text),
    }
  }

  private commandHandlers(): Record<string, Handler> {
    const env = this.env
    return {
      ...globalCommands(env),
      ...commitCommands(env),
      ...fileCommands(env),
      ...bookmarkCommands(env),
      ...requestCommands(env),
      ...workspaceCommands(env),
      ...evolutionCommands(env),
      ...operationCommands(env),
      ...fileHistoryCommands(env),
      'ukemi.showLog': () => this.shell('showLog'),
      'ukemi.repoTab.rename': (arg) =>
        this.withTab(arg, (repoId) => {
          this.post({ type: 'desktop.startRename', repoId })
        }),
      'ukemi.repoTab.pin': (arg) =>
        this.withTab(arg, (repoId) => this.context.repoTabs.change((p) => pin(p, repoId))),
      'ukemi.repoTab.unpin': (arg) =>
        this.withTab(arg, (repoId) => this.context.repoTabs.change((p) => unpin(p, repoId))),
      'ukemi.openView': () => this.focus(),
    }
  }

  // Runs a tab command for a repository this window shows. The menu passes `{ repoId }`.
  private async withTab(arg: unknown, fn: (repoId: string) => unknown): Promise<void> {
    const repoId = isRecord(arg) ? arg.repoId : undefined
    if (typeof repoId === 'string' && this.isOpenRepo(repoId)) {
      await fn(repoId)
    }
  }

  private isOpenRepo(repoId: unknown): repoId is string {
    return this.registry.summaries().some((summary) => summary.id === repoId)
  }

  // The tabs as the window shows them, for moves by index.
  private visibleTabs(): string[] {
    return arrangeTabs(this.registry.summaries(), this.context.repoTabs.read()).map((t) => t.id)
  }

  private async handleDesktop(message: DesktopRendererMessage): Promise<void> {
    switch (message.type) {
      case 'desktop.renameTab':
        if (this.isOpenRepo(message.repoId) && typeof message.name === 'string') {
          const { repoId, name } = message
          await this.context.repoTabs.change((p) => rename(p, repoId, name))
        }
        return
      case 'desktop.moveTab':
        if (this.isOpenRepo(message.repoId)) {
          const { repoId, toIndex, offset } = message
          const visible = this.visibleTabs()
          const target = Number.isFinite(offset)
            ? visible.indexOf(repoId) + Number(offset)
            : Number(toIndex)
          if (Number.isFinite(target)) {
            await this.context.repoTabs.change((p) => move(p, visible, repoId, target))
          }
        }
        return
      case 'desktop.uiAnswer':
        if (typeof message.id === 'number' && isRecord(message.answer)) {
          this.ui.answer(message.id, message.answer)
        }
        return
      case 'desktop.run':
        if (typeof message.command === 'string') {
          await this.run(message.command, message.arg)
        }
        return
      case 'desktop.contextMenu':
        if (isRecord(message.context)) {
          this.popup(
            webviewMenu(message.context, (c) => this.offers(c)),
            message.context,
            message,
          )
        }
        return
      case 'desktop.rowMenu':
        if (isRecord(message.row) && typeof message.row.contextValue === 'string') {
          const row = message.row
          this.popup(
            treeItemMenu(row.view, row.contextValue, (c) => this.offers(c)),
            row.arg,
            message,
          )
        }
        return
      case 'desktop.panel':
        this.panelTabs.receive(String(message.panelId), message.message)
        return
      case 'desktop.tabClosed':
        this.panelTabs.closedInWindow(String(message.id))
        return
      case 'desktop.loadSettings':
        this.settingsForm.post()
        return
      case 'desktop.setSetting':
        await this.settingsForm.set(message.key, message.value, message.repoId)
        return
      case 'desktop.openSettingsFile':
        this.context.openSettingsFile()
        return
      case 'desktop.openLogFile':
        this.context.openLogFile()
        return
      case 'desktop.clearLog':
        this.context.logger.clear()
        this.context.broadcastLog()
        return
      case 'desktop.recordShortcut':
        this.window.webContents.setIgnoreMenuShortcuts(message.isRecording === true)
        return
      case 'desktop.zoom':
        if (message.step === 'in' || message.step === 'out' || message.step === 'reset') {
          this.context.zoom(message.step)
        }
        return
      case 'desktop.openRepo': {
        const folder = await this.ui.pickFolder('Open Repository')
        if (folder) {
          await this.addFolder(folder)
        }
        return
      }
      case 'desktop.openPaths': {
        const paths = droppedPaths(message.paths)
        if (paths) {
          await this.openDropped(paths)
        } else {
          this.context.logger.warn('ignored a drop that is not a short list of absolute paths')
        }
        return
      }
      case 'desktop.closeRepo':
        if (typeof message.repoId === 'string') {
          await this.closeRepo(message.repoId)
        }
        return
      case 'desktop.terminalCreate':
        this.terminals.open(this.registry.activeModel?.root ?? this.folderList[0] ?? homedir())
        return
      case 'desktop.terminalStart':
        await this.terminals.start(String(message.id), message.cols, message.rows)
        return
      case 'desktop.terminalInput':
        this.terminals.write(String(message.id), message.data)
        return
      case 'desktop.terminalResize':
        this.terminals.resize(String(message.id), message.cols, message.rows)
        return
      case 'desktop.terminalClose':
        this.terminals.close(String(message.id))
        return
      case 'desktop.copy':
        if (typeof message.text === 'string') {
          clipboard.writeText(message.text)
        }
        return
      case 'desktop.openExternal':
        if (typeof message.url === 'string' && /^https:\/\//.test(message.url)) {
          await shell.openExternal(message.url)
        }
        return
      case 'desktop.titleMenu':
        this.popup(
          graphTitleMenu((c) => this.offers(c), this.context.settings.read().changedFilesView),
          undefined,
          message,
        )
        return
      case 'desktop.loadDiff':
        if (typeof message.commitId === 'string') {
          await this.loadDiff(message.commitId, message.path)
        }
        return
    }
  }

  private popup(entries: MenuEntry[], arg: unknown, at: { x: number; y: number }): void {
    if (entries.length === 0) {
      return
    }
    const menu = Menu.buildFromTemplate(menuTemplate(entries, arg, (c, a) => void this.run(c, a)))
    menu.popup({ window: this.window, x: Math.round(at.x), y: Math.round(at.y) })
  }

  private async loadDiff(commitId: string, path?: string): Promise<void> {
    const model = this.registry.activeModel
    const commit = model?.findCommit(commitId)
    if (!model || !commit) {
      return
    }
    const files = commit.isWorkingCopy
      ? (model.graph?.workingCopyFiles ?? [])
      : await model.filesFor(commit.commitId)
    const file = path ? files.find((item) => item.path === path) : undefined
    if (file) {
      await this.env.workbench.openFileDiff(model, commit, file)
    } else if (!path) {
      await this.env.workbench.openCommitDiff(model, commit, files)
    }
  }

  private sendInitial(): void {
    this.detail.forgetPosted()
    const offers = (command: string) => this.offers(command)
    this.post({ type: 'fileIcons', theme: null })
    this.post({ type: 'desktop.window', title: this.title(), platform: process.platform })
    this.post({ type: 'desktop.fonts', fonts: this.context.fonts() })
    this.post({ type: 'desktop.zoom', percent: zoomPercent(this.context.zoomFactor()) })
    this.postLog(this.context.logger.recent(), true)
    this.post({
      type: 'desktop.commands',
      commands: paletteCommands(offers),
      toolbar: graphTitleMenu(offers, this.context.settings.read().changedFilesView),
    })
    this.postState()
  }

  private scheduleState(): void {
    if (this.stateTimer || this.isClosed) {
      return
    }
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null
      this.postState()
    }, STATE_DEBOUNCE_MS)
  }

  private postState(): void {
    if (!this.isReady || this.isClosed) {
      return
    }
    const state = buildViewState({
      isJjAvailable: this.context.jj.path !== null,
      hasFolders: this.folderList.length > 0,
      registry: this.registry,
      operations: this.operations,
      // The active repository's settings, with its overrides.
      config: this.context.settings.read(this.registry.activeModel?.root),
      autoFetch: this.autoFetch,
    })
    const repos = arrangeTabs(state.repos, this.context.repoTabs.read())
    this.post({ type: 'state', state: { ...state, repos } })
    const panels = sidePanels(this.registry.activeModel, this.folderList)
    this.post({
      type: 'desktop.panels',
      panels: {
        bookmarks: panels.bookmarks.map((group) => ({
          ...group,
          rows: group.rows.map((row) => this.withActions(row)),
        })),
        workspaces: panels.workspaces.map((row) => this.withActions(row)),
        operations: panels.operations.map((row) => this.withActions(row)),
      },
    })
    void this.detail.refresh()
  }

  private async askTrust(): Promise<void> {
    const untrusted = this.folderList.filter((folder) => !this.context.trust.isTrusted(folder))
    if (untrusted.length === 0 || this.isClosed) {
      return
    }
    const names = untrusted.map((folder) => basename(folder)).join(', ')
    const answer = await this.ui.ask(
      'warning',
      `Trust ${names}?`,
      { detail: TRUST_DETAIL },
      'Trust',
    )
    if (answer !== 'Trust') {
      return
    }
    for (const folder of untrusted) {
      await this.context.trust.trust(folder)
    }
    this.trustEmitter.fire()
  }

  private withActions(row: SidePanelRow): SidePanelRow {
    return { ...row, inline: treeItemActions(row.view, row.contextValue, (c) => this.offers(c)) }
  }

  // A message in this window with buttons, like the editor's notifications.
  notify(text: string, ...actions: string[]): Promise<string | undefined> {
    return this.ui.info(text, ...actions)
  }

  private post(message: ShellInbound): void {
    if (!this.isClosed && this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(TO_RENDERER, message)
    }
  }
}
