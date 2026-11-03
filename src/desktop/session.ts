import { homedir } from 'node:os'
import { basename } from 'node:path'
import { BrowserWindow, Menu, clipboard, dialog, shell } from 'electron'
import type {
  ChangeDetail,
  LogLine,
  SidePanelRow,
  DesktopRendererMessage,
  ShellAction,
  ShellInbound,
} from '../../shared/desktopProtocol'
import { isDesktopMessage } from '../../shared/desktopProtocol'
import type { MenuEntry } from '../../shared/menus'
import type { CommitView, WebviewMessage } from '../../shared/protocol'
import { isRepositoryKey } from '../../shared/settingsScope'
import { AutoFetcher } from '../app/autoFetch'
import { ChangeSelection } from '../app/changeSelection'
import { commitCommands } from '../app/commands/commitCommands'
import type { CommandEnv, Handler } from '../app/commands/context'
import { evolutionCommands } from '../app/commands/evolutionCommands'
import { fileCommands } from '../app/commands/fileCommands'
import { globalCommands } from '../app/commands/globalCommands'
import { refCommands } from '../app/commands/refCommands'
import { workspaceCommands } from '../app/commands/workspaceCommands'
import { Emitter, disposeAll, type Disposable } from '../app/events'
import { ForgeService } from '../app/forgeService'
import type { FolderSource, Host, WindowState } from '../app/host'
import { createMessageHandler } from '../app/messages'
import { Operations } from '../app/operations'
import type { PanelChannel, PanelHandler } from '../app/panel'
import { RepoRegistry } from '../app/registry'
import { watchRepositorySettings } from '../app/settingsEffects'
import { sidePanels } from '../app/sidePanels'
import { evolutionVersionNodes } from '../repo/evolutionItems'
import { buildViewState } from '../app/viewState'
import { AskpassServer } from '../askpass/server'
import { JjRunner } from '../jj/runner'
import { errorMessage, type Logger } from '../util/logger'
import { LoopbackRedirect } from './adapters/loopbackRedirect'
import { RendererUi, type NativeUi } from './adapters/rendererUi'
import { fsWatchRepo } from './adapters/watchRepo'
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
import { settingFields } from './settingsSchema'
import { foldersAfterClosing } from './startup'
import { Terminals } from './terminals'
import { desktopWorkbench, type PanelEntry } from './workbench'
import { cliSuggesters, DescriptionSuggestions } from '../app/describeSuggest/service'

const COMMAND_ID = /^ukemi\.[\w.]+$/
const STATE_DEBOUNCE_MS = 16

const UNTRUSTED_MESSAGE =
  'Ukemi: trust this repository to sign in to a forge. Reopen it and choose Trust.'

const TRUST_DETAIL =
  'Ukemi only signs in to GitHub or GitLab, and only hands stored credentials to git, in repositories you trust. A repository chooses which servers its remotes point to.'

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

interface Tab {
  receive: (message: unknown) => void
  closed: () => void
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
  private readonly tabs = new Map<string, Tab>()
  private nextTab = 1
  // Tab ids by the key their opener gave, for tabs that open once.
  private readonly tabKeys = new Map<string, string>()
  private readonly disposables: Disposable[] = []
  private isReady = false
  // The repository the settings form last showed.
  private settingsRoot: string | null = null
  private isClosed = false
  // Native dialogs need a mapped parent. On Wayland, a dialog on a hidden window kills the app.
  private shown!: Promise<void>
  private stateTimer: ReturnType<typeof setTimeout> | null = null
  private detail: { repoId: string; commitId: string; changeId: string } | null = null
  private detailGeneration = 0
  // What the renderer shows, so a refresh that changes nothing does not redraw the panel.
  private postedDetail: string | null = null
  private postedChangeId: string | null = null

  constructor(
    private readonly context: DesktopContext,
    folders: readonly string[],
  ) {
    this.folderList = [...new Set(folders)]
    const logger = context.logger
    this.ui = new RendererUi((message) => this.post(message), this.nativeUi())
    this.terminals = new Terminals((message) => this.post(message), logger)
    this.runner = new JjRunner(context.jj.path ?? 'jj', logger)
    this.askpass = new AskpassServer(
      process.execPath,
      [context.paths.helper('askpass.js')],
      (request) => this.forge.gitCredential(request),
    )

    const host = this.host()
    this.registry = new RepoRegistry(this.runner, logger, host)
    this.operations = new Operations(logger)
    this.forge = new ForgeService(this.registry, host, logger, {
      githubSession: null,
      gitlabRedirect: new LoopbackRedirect(),
      untrustedMessage: UNTRUSTED_MESSAGE,
    })
    this.autoFetch = new AutoFetcher(this.registry, this.forge, this.operations, logger, host)
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
      this.registry.onDidChange(() => {
        this.scheduleState()
        // The form's "This repository" mode follows the active repository.
        if (this.settingsRoot !== (this.registry.activeModel?.root ?? null)) {
          this.postSettings()
        }
      }),
      this.registry.onDidChangeModel(() => this.scheduleState()),
      this.operations.onDidChange(() => this.scheduleState()),
      this.autoFetch.onDidChange(() => this.scheduleState()),
      context.repoTabs.onDidChange(() => this.scheduleState()),
      context.settings.onDidChange(() => {
        this.scheduleState()
        this.postSettings()
        this.post({ type: 'desktop.fonts', fonts: context.fonts() })
      }),
      watchRepositorySettings(context.settings, this.registry),
    )
    this.window = this.createWindow()
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
        return
      }
      await this.handleWebview(message)
      if (message.type === 'selectCommit') {
        await this.showDetail(message.commitId)
      }
    } catch (error: unknown) {
      this.context.logger.error(`window message ${raw.type} failed: ${errorMessage(error)}`)
    }
  }

  // Opens a repository as a tab of this window and shows it.
  async addFolder(root: string): Promise<void> {
    if (!this.folderList.includes(root)) {
      this.folderList.push(root)
      this.context.foldersChanged()
      this.window.setTitle(this.title())
      void this.askTrust()
      await this.registry.discover()
    }
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

  showSettings(): void {
    this.postSettings()
    this.shell('settings')
  }

  async showRepositorySettings(root: string): Promise<void> {
    if (this.registry.activeModel?.root !== root) {
      await this.registry.setActive(root)
    }
    this.postSettings()
    this.shell('repositorySettings')
  }

  showAbout(): void {
    const info = this.context.about()
    this.post({ type: 'desktop.about', info, text: aboutText(info) })
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
    for (const tab of this.tabs.values()) {
      tab.closed()
    }
    this.tabs.clear()
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
            this.openPanelTab(entry, title, connect, key),
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

  private createWindow(): BrowserWindow {
    const saved = this.context.windowBounds()
    const window = new BrowserWindow({
      width: saved.width,
      height: saved.height,
      minWidth: 720,
      minHeight: 480,
      title: this.title(),
      show: false,
      backgroundColor: this.context.backgroundColor(),
      ...(process.platform === 'darwin' ? {} : { icon: this.context.paths.icon }),
      webPreferences: {
        preload: this.context.paths.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: true,
      },
    })
    this.shown = new Promise((resolve) => {
      window.once('show', () => resolve())
      window.once('closed', () => resolve())
    })
    window.once('ready-to-show', () => window.show())
    window.on('focus', () => this.focusEmitter.fire())
    window.on('resize', () => this.context.saveWindowBounds(window.getBounds()))
    window.on('closed', () => this.context.closeSession(this))
    this.context.guardNavigation(window)
    void window.loadURL(this.context.pageUrl('desktop'))
    return window
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
      store: context.state.scoped('window'),
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
      ...refCommands(env),
      ...workspaceCommands(env),
      ...evolutionCommands(env),
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
        this.tabs.get(String(message.panelId))?.receive(message.message)
        return
      case 'desktop.tabClosed': {
        const id = String(message.id)
        const tab = this.tabs.get(id)
        this.tabs.delete(id)
        tab?.closed()
        this.post({ type: 'desktop.tabClose', id })
        return
      }
      case 'desktop.loadSettings':
        this.postSettings()
        return
      case 'desktop.setSetting':
        await this.setSetting(message.key, message.value, message.repoId)
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
      case 'desktop.openRepo': {
        const folder = await this.ui.pickFolder('Open Repository')
        if (folder) {
          await this.addFolder(folder)
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
          graphTitleMenu((c) => this.offers(c)),
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
    this.postedDetail = null
    this.postedChangeId = null
    const offers = (command: string) => this.offers(command)
    this.post({ type: 'fileIcons', theme: null })
    this.post({ type: 'desktop.window', title: this.title(), platform: process.platform })
    this.post({ type: 'desktop.fonts', fonts: this.context.fonts() })
    this.postLog(this.context.logger.recent(), true)
    this.post({
      type: 'desktop.commands',
      commands: paletteCommands(offers),
      toolbar: graphTitleMenu(offers),
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
      },
    })
    void this.refreshDetail()
  }

  private async showDetail(commitId: string): Promise<void> {
    const model = this.registry.activeModel
    const commit = model?.findCommit(commitId)
    this.detail =
      model && commit ? { repoId: model.root, commitId, changeId: commit.changeId } : null
    await this.refreshDetail()
  }

  // Follows the selected change through rewrites, by its change id.
  private async refreshDetail(): Promise<void> {
    const generation = ++this.detailGeneration
    const model = this.registry.activeModel
    const selected = this.detail
    const commit =
      model && selected?.repoId === model.root
        ? model.commitFor(selected.commitId, selected.changeId)
        : null
    if (!model || !selected || !commit) {
      this.postDetail(null)
      return
    }
    this.detail = { ...selected, commitId: commit.commitId }
    try {
      const files = commit.isWorkingCopy
        ? (model.graph?.workingCopyFiles ?? [])
        : await model.filesFor(commit.commitId)
      const detail: ChangeDetail = { repoId: model.root, commit, files, evolution: null }
      // Another change shows "Loading…" at once; the same one is posted once, with its evolution, so the rows never blank out.
      if (generation === this.detailGeneration && this.postedChangeId !== commit.changeId) {
        this.postDetail(detail)
      }
      const evolution = await this.evolution(commit)
      if (generation === this.detailGeneration) {
        this.postDetail({ ...detail, evolution })
      }
    } catch (error: unknown) {
      this.context.logger.warn(`loading the change details failed: ${errorMessage(error)}`)
    }
  }

  private postDetail(detail: ChangeDetail | null): void {
    const serialized = JSON.stringify(detail)
    if (serialized === this.postedDetail) {
      return
    }
    this.postedDetail = serialized
    this.postedChangeId = detail?.commit.changeId ?? null
    this.post({ type: 'desktop.detail', detail })
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

  // Opens Split or Clean up as a tab next to the change details. Its messages travel wrapped,
  // so several tabs and the graph share the window's channel.
  private openPanelTab<H, W>(
    entry: PanelEntry,
    title: string,
    connect: (channel: PanelChannel<H>) => PanelHandler<W>,
    key?: string,
  ): void {
    const known = key ? this.tabKeys.get(key) : undefined
    if (known && this.tabs.has(known)) {
      this.post({ type: 'desktop.tabOpen', tab: { id: known, kind: entry, title } })
      return
    }
    const id = `${entry}-${this.nextTab++}`
    if (key) {
      this.tabKeys.set(key, id)
    }
    let closed = false
    const channel: PanelChannel<H> = {
      post: async (message) => {
        if (!closed) {
          this.post({ type: 'desktop.panel', panelId: id, message })
        }
      },
      close: () => {
        if (!closed) {
          closed = true
          this.tabs.delete(id)
          this.post({ type: 'desktop.tabClose', id })
        }
      },
      get isClosed() {
        return closed
      },
    }
    const handler = connect(channel)
    this.tabs.set(id, {
      receive: (message) => {
        if (isMessage(message)) {
          void handler(message as W).catch((error: unknown) =>
            this.context.logger.error(`${entry} message failed: ${errorMessage(error)}`),
          )
        }
      },
      closed: () => {
        closed = true
      },
    })
    this.post({ type: 'desktop.tabOpen', tab: { id, kind: entry, title } })
  }

  private withActions(row: SidePanelRow): SidePanelRow {
    return { ...row, inline: treeItemActions(row.view, row.contextValue, (c) => this.offers(c)) }
  }

  private async setSetting(key: unknown, value: unknown, repoId: unknown): Promise<void> {
    if (typeof key !== 'string' || !settingFields({}).some((f) => f.key === key)) {
      return
    }
    if (repoId === undefined) {
      await this.context.settings.update(key, value)
      return
    }
    // Only open repositories, so the renderer cannot write overrides for arbitrary paths.
    const isOpen = this.registry.summaries().some((summary) => summary.id === repoId)
    if (typeof repoId === 'string' && isOpen && isRepositoryKey(key)) {
      await this.context.settings.update(key, value, { root: repoId })
    }
  }

  private postSettings(): void {
    const settings = this.context.settings
    const overrides = settings.overrides()
    const labels = new Map(this.registry.summaries().map((s) => [s.id, s.label]))
    const overriddenIn = (key: string) =>
      [...overrides]
        .filter(([, values]) => key in values)
        .map(([root]) => labels.get(root) ?? basename(root))
    const root = this.registry.activeModel?.root ?? null
    this.settingsRoot = root
    this.post({
      type: 'desktop.settings',
      fields: settingFields(settings.values(), overriddenIn),
      path: settings.path,
      repository: root
        ? {
            id: root,
            label: labels.get(root) ?? basename(root),
            values: { ...settings.values(root) },
          }
        : null,
    })
  }

  private async evolution(commit: CommitView): Promise<SidePanelRow[]> {
    const model = this.registry.activeModel
    if (!model) {
      return []
    }
    try {
      const entries = await model.evolutionFor(commit.commitId)
      const config = this.context.settings.read()
      return evolutionVersionNodes(
        entries,
        {
          repoId: model.root,
          commitId: commit.commitId,
          changeId: commit.changeId,
          isImmutable: commit.isImmutable,
        },
        { now: Date.now(), changeIdLength: config.changeIdLength },
      ).map((node) =>
        this.withActions({
          id: node.id,
          label: node.label,
          description: node.description,
          tooltip: node.tooltip,
          icon: node.versionCommitId === commit.commitId ? 'circle-filled' : 'circle-outline',
          contextValue: node.contextValue,
          view: 'ukemi.evolution',
          arg: node,
          ...(node.previousCommitId ? { defaultCommand: 'ukemi.evolution.open' } : {}),
        }),
      )
    } catch (error: unknown) {
      this.context.logger.warn(`loading the evolution failed: ${errorMessage(error)}`)
      return []
    }
  }

  private post(message: ShellInbound): void {
    if (!this.isClosed && this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(TO_RENDERER, message)
    }
  }
}
