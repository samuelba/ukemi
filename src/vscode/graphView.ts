import * as vscode from 'vscode'
import type { FileIconTheme } from '../../shared/fileIconTheme'
import type { HostMessage, ViewState, WebviewMessage } from '../../shared/protocol'
import type { GraphSurface } from '../app/commands/context'
import type { Operations } from '../app/operations'
import type { RepoRegistry } from '../app/registry'
import { buildViewState } from '../app/viewState'
import { errorMessage, type Logger } from '../util/logger'
import { readConfig } from './config'
import { iconThemeResourceRoots, loadFileIconTheme } from './fileIconTheme'
import { createUkemiPanel, webviewHtml } from './webviewPanel'

export const GRAPH_VIEW_ID = 'ukemi.graph'
const PANEL_VIEW_TYPE = 'ukemi.graphPanel'
const SETTINGS_COMMAND_URIS = [
  'workbench.action.openSettings',
  '/workbench.action.openSettings',
] as const

export type MessageHandler = (message: WebviewMessage) => Promise<void>

export interface JjAvailability {
  isAvailable: boolean
}

export class GraphView implements vscode.WebviewViewProvider, vscode.Disposable, GraphSurface {
  private readonly webviews = new Set<vscode.Webview>()
  private view: vscode.WebviewView | null = null
  private panel: vscode.WebviewPanel | null = null
  private handler: MessageHandler = async () => undefined
  private pendingReveal: string | null = null
  private iconGeneration = 0
  private readonly readyWebviews = new WeakSet<vscode.Webview>()
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly registry: RepoRegistry,
    private readonly operations: Operations,
    private readonly jj: JjAvailability,
    private readonly logger: Logger,
  ) {
    this.disposables.push(
      registry.onDidChange(() => this.postState()),
      operations.onDidChange(() => this.postState()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('ukemi')) {
          this.postState()
        }
        if (e.affectsConfiguration('workbench.iconTheme')) {
          this.postFileIcons()
        }
      }),
      vscode.window.onDidChangeActiveColorTheme(() => this.postFileIcons()),
    )
  }

  setHandler(handler: MessageHandler): void {
    this.handler = handler
  }

  get isVisible(): boolean {
    return (this.view?.visible ?? false) || (this.panel?.visible ?? false)
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    this.attach(view.webview)
    view.onDidDispose(() => {
      this.webviews.delete(view.webview)
      this.view = null
    })
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.postState()
      }
    })
  }

  async focus(): Promise<void> {
    if (this.panel || readConfig().showInPanel) {
      this.openPanel()
    }
    if (!readConfig().showInPanel) {
      await vscode.commands.executeCommand(`${GRAPH_VIEW_ID}.focus`)
    }
  }

  async showCommit(commitId: string): Promise<void> {
    await this.focus()
    this.pendingReveal = commitId
    const opened = this.panel?.webview
    const waitingForNew = opened !== undefined && !this.readyWebviews.has(opened)
    if (!waitingForNew && this.hasReadyWebview()) {
      this.pendingReveal = null
      this.post({ type: 'reveal', commitId })
    }
  }

  openPanel(): void {
    if (this.panel) {
      this.panel.reveal()
      return
    }
    const panel = createUkemiPanel(this.extensionUri, PANEL_VIEW_TYPE, 'Ukemi', {
      enableCommandUris: [...SETTINGS_COMMAND_URIS],
      retainContextWhenHidden: true,
      localResourceRoots: iconThemeResourceRoots(this.extensionUri),
    })
    this.panel = panel
    this.attach(panel.webview)
    panel.onDidDispose(() => {
      this.webviews.delete(panel.webview)
      this.panel = null
    })
  }

  private attach(webview: vscode.Webview): void {
    webview.options = {
      enableScripts: true,
      enableCommandUris: [...SETTINGS_COMMAND_URIS],
      localResourceRoots: iconThemeResourceRoots(this.extensionUri),
    }
    webview.html = webviewHtml(
      webview,
      this.extensionUri,
      'graph',
      vscode.env.appName === 'Cursor' ? ' data-cursor="1"' : '',
    )
    webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      if (message.type === 'ready') {
        this.readyWebviews.add(webview)
        this.postState()
        this.postFileIcons()
        this.flushReveal()
        return
      }
      try {
        await this.handler(message)
      } catch (error: unknown) {
        this.logger.error(`webview message ${message.type} failed: ${errorMessage(error)}`)
      }
    })
    this.webviews.add(webview)
  }

  private hasReadyWebview(): boolean {
    for (const webview of this.webviews) {
      if (this.readyWebviews.has(webview)) {
        return true
      }
    }
    return false
  }

  private flushReveal(): void {
    if (!this.pendingReveal || !this.hasReadyWebview()) {
      return
    }
    const commitId = this.pendingReveal
    this.pendingReveal = null
    this.post({ type: 'reveal', commitId })
  }

  post(message: HostMessage): void {
    for (const webview of this.webviews) {
      void webview.postMessage(message)
    }
  }

  private postFileIcons(): void {
    const generation = ++this.iconGeneration
    for (const webview of this.webviews) {
      void this.sendFileIcons(webview, generation)
    }
  }

  private async sendFileIcons(webview: vscode.Webview, generation: number): Promise<void> {
    let theme: FileIconTheme | null = null
    try {
      theme = await loadFileIconTheme(webview)
    } catch (error: unknown) {
      this.logger.error(`file icons failed: ${errorMessage(error)}`)
    }
    if (generation !== this.iconGeneration || !this.webviews.has(webview)) {
      return
    }
    try {
      await webview.postMessage({ type: 'fileIcons', theme })
    } catch (error: unknown) {
      this.logger.error(`file icons post failed: ${errorMessage(error)}`)
    }
  }

  state(): ViewState {
    return buildViewState({
      isJjAvailable: this.jj.isAvailable,
      hasFolders: (vscode.workspace.workspaceFolders ?? []).length > 0,
      registry: this.registry,
      operations: this.operations,
      config: readConfig(this.registry.activeModel?.root),
    })
  }

  postState(): void {
    const state = this.state()
    this.post({ type: 'state', state })
    this.updateBadge(state)
  }

  private updateBadge(state: ViewState): void {
    if (!this.view) {
      return
    }
    const count = state.graph?.workingCopyFiles.length ?? 0
    this.view.badge =
      count > 0 ? { value: count, tooltip: `${count} changed files in @` } : undefined
    const active = state.repos.find((r) => r.id === state.activeRepoId)
    this.view.description = state.repos.length > 1 ? active?.label : undefined
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose())
    this.panel?.dispose()
  }
}
