import * as vscode from 'vscode'
import { AskpassServer } from './askpass/server'
import { JjRunner } from './jj/runner'
import { errorMessage } from './util/logger'
import { commitCommands } from './vscode/commands/commitCommands'
import { contextCommit, registerAll, type CommandEnv } from './vscode/commands/context'
import { evolutionCommands } from './vscode/commands/evolutionCommands'
import { fileCommands } from './vscode/commands/fileCommands'
import { globalCommands } from './vscode/commands/globalCommands'
import { refCommands } from './vscode/commands/refCommands'
import { workspaceCommands } from './vscode/commands/workspaceCommands'
import {
  DIFF_SCHEME,
  INTERDIFF_SCHEME,
  InterdiffContentProvider,
  RevisionContentProvider,
} from './vscode/diff'
import { ChangeSelection } from './vscode/changeSelection'
import { EvolutionView } from './vscode/evolutionView'
import { ForgeService } from './vscode/forgeService'
import { GRAPH_VIEW_ID, GraphView } from './vscode/graphView'
import { installJj, locateJj, offerInstall, updateTerminalPath } from './vscode/jjSetup'
import { AutoFetcher } from './vscode/autoFetch'
import { Operations } from './vscode/operations'
import { createOutputLogger } from './vscode/outputLogger'
import { RepoRegistry } from './vscode/registry'
import { ScmController } from './vscode/scm'
import { openSplitPanel } from './vscode/splitPanel'
import { RepoStatusBar } from './vscode/statusBar'
import { WorkspacesView } from './vscode/workspacesView'
import { createMessageHandler } from './vscode/webviewMessages'

export interface UkemiApi {
  readonly registry: RepoRegistry
}

export async function activate(context: vscode.ExtensionContext): Promise<UkemiApi> {
  void vscode.commands.executeCommand(
    'setContext',
    'ukemi.inCursor',
    vscode.env.appName === 'Cursor',
  )
  const channel = vscode.window.createOutputChannel('Ukemi', { log: true })
  const logger = createOutputLogger(channel)
  const storageDir = context.globalStorageUri.fsPath

  const located = await locateJj(storageDir, logger)
  const runner = new JjRunner(located?.path ?? 'jj', logger)
  const availability = { isAvailable: located !== null }
  updateTerminalPath(context, located)

  const registry = new RepoRegistry(runner, logger, context.workspaceState)
  const operations = new Operations(logger)
  const graphView = new GraphView(context.extensionUri, registry, operations, availability, logger)
  const selection = new ChangeSelection()
  const evolutionView = new EvolutionView(registry, selection, logger)
  const workspacesView = new WorkspacesView(registry)
  const forge = new ForgeService(registry, context.secrets, logger, context.extension.id)
  const askpass = new AskpassServer(
    process.execPath,
    [vscode.Uri.joinPath(context.extensionUri, 'dist', 'askpass.js').fsPath],
    (request) => forge.gitCredential(request),
  )
  try {
    await askpass.start()
    runner.setEnvironment(askpass.env)
  } catch (error) {
    logger.warn(`git sign-in over HTTPS is not available: ${errorMessage(error)}`)
  }
  const autoFetch = new AutoFetcher(registry, forge, operations, logger)
  const env: CommandEnv = {
    registry,
    operations,
    graphView,
    forge,
    runner,
    logger,
    extensionId: context.extension.id,
    extensionUri: context.extensionUri,
    storageUri: context.globalStorageUri,
    selection,
    autoFetch,
  }
  graphView.setHandler(createMessageHandler(env))

  const reloadJj = async () => {
    const found = await locateJj(storageDir, logger)
    availability.isAvailable = found !== null
    if (found) {
      runner.useBinary(found.path)
    }
    updateTerminalPath(context, found)
    await registry.discover()
    graphView.postState()
  }

  context.subscriptions.push(
    channel,
    askpass,
    autoFetch,
    registry,
    operations,
    graphView,
    evolutionView,
    selection,
    forge,
    new ScmController(registry),
    new RepoStatusBar(registry),
    workspacesView,
    vscode.window.registerTreeDataProvider('ukemi.workspaces', workspacesView),
    vscode.window.registerWebviewViewProvider(GRAPH_VIEW_ID, graphView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.registerTextDocumentContentProvider(
      DIFF_SCHEME,
      new RevisionContentProvider(registry),
    ),
    vscode.workspace.registerTextDocumentContentProvider(
      INTERDIFF_SCHEME,
      new InterdiffContentProvider(registry),
    ),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (
        e.affectsConfiguration('ukemi.jjPath') ||
        e.affectsConfiguration('ukemi.addJjToTerminalPath')
      ) {
        await reloadJj()
      } else if (
        e.affectsConfiguration('ukemi.repoScanDepth') ||
        e.affectsConfiguration('ukemi.repoScanExclude')
      ) {
        await registry.discover()
      } else if (e.affectsConfiguration('ukemi.workspaces.snapshotOnRefresh')) {
        registry.applyWorkspaceSettings()
      } else if (e.affectsConfiguration('ukemi.showLineStats')) {
        await registry.applyLineStats()
      }
    }),
  )

  registerAll(context, {
    ...globalCommands(env),
    ...commitCommands(env),
    ...fileCommands(env),
    ...refCommands(env),
    ...workspaceCommands(env),
    ...evolutionCommands(env),
    'ukemi.evolution.follow': () => {
      selection.toggleFollow(evolutionView.currentSelection())
    },
    'ukemi.split.open': async (arg?: unknown) => {
      const target = contextCommit(env, arg)
      if (target) {
        await openSplitPanel(env, target)
      }
    },
    'ukemi.installJj': async () => {
      if (await installJj(storageDir, logger)) {
        await reloadJj()
      }
    },
    'ukemi.showLog': () => channel.show(),
  })

  if (!located) {
    void offerInstall(storageDir, logger).then((installed) => (installed ? reloadJj() : undefined))
  }
  await registry.discover()
  return { registry }
}

export function deactivate(): void {
  return undefined
}
