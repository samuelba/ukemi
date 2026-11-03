import * as vscode from 'vscode'
import { answerPrompt } from './app/askpassPrompts'
import { AutoFetcher } from './app/autoFetch'
import { ChangeSelection } from './app/changeSelection'
import { commitCommands } from './app/commands/commitCommands'
import type { CommandEnv } from './app/commands/context'
import { evolutionCommands } from './app/commands/evolutionCommands'
import { operationCommands } from './app/commands/operationCommands'
import { fileHistoryCommands } from './app/commands/fileHistoryCommands'
import { fileCommands } from './app/commands/fileCommands'
import { globalCommands } from './app/commands/globalCommands'
import { refCommands } from './app/commands/refCommands'
import { workspaceCommands } from './app/commands/workspaceCommands'
import { ForgeService } from './app/forgeService'
import { createMessageHandler } from './app/messages'
import { Operations } from './app/operations'
import { RepoRegistry } from './app/registry'
import { affectsJj, applyRepositorySettings, JJ_SETTINGS } from './app/settingsEffects'
import { AskpassServer } from './askpass/server'
import { JjRunner } from './jj/runner'
import { errorMessage } from './util/logger'
import { BookmarksView } from './vscode/bookmarksView'
import { editorFileCommands } from './vscode/commands/editorCommands'
import { registerAll } from './vscode/commands/register'
import { viewCommands } from './vscode/commands/viewCommands'
import { vscodeSettings } from './vscode/config'
import { ConflictDecorator } from './vscode/conflictDecorations'
import { conflictCommands, registerConflictLenses } from './vscode/conflictLens'
import {
  DIFF_SCHEME,
  INTERDIFF_SCHEME,
  InterdiffContentProvider,
  RevisionContentProvider,
} from './vscode/diff'
import { EvolutionView } from './vscode/evolutionView'
import { vscodeForgeAccounts } from './vscode/forgeAccounts'
import { GRAPH_VIEW_ID, GraphView } from './vscode/graphView'
import { installJj, locateJj, offerInstall, updateTerminalPath } from './vscode/jjSetup'
import { createOutputLogger } from './vscode/outputLogger'
import { ScmController } from './vscode/scm'
import { LOG_CHANNEL_NAME, showLog } from './vscode/showLog'
import { RepoStatusBar } from './vscode/statusBar'
import { vscodeHost } from './vscode/vscodeHost'
import { vscodeWorkbench } from './vscode/workbench'
import { LanguageModelSuggester } from './vscode/languageModelSuggester'
import { cliSuggesters, DescriptionSuggestions } from './app/describeSuggest/service'
import { WorkspacesView } from './vscode/workspacesView'
import { OperationsView } from './vscode/operationsView'
import { FileHistoryView } from './vscode/fileHistoryView'
import { InlineBlame } from './vscode/blameDecorations'

export interface UkemiApi {
  readonly registry: RepoRegistry
}

const EVOLUTION_FOLLOWING = 'ukemi.evolution.following'

export async function activate(context: vscode.ExtensionContext): Promise<UkemiApi> {
  void vscode.commands.executeCommand(
    'setContext',
    'ukemi.inCursor',
    vscode.env.appName === 'Cursor',
  )
  const channel = vscode.window.createOutputChannel(LOG_CHANNEL_NAME, { log: true })
  const logger = createOutputLogger(channel)
  const storageDir = context.globalStorageUri.fsPath
  const settings = vscodeSettings()
  const host = vscodeHost(context, settings)

  const located = await locateJj(storageDir, logger)
  const runner = new JjRunner(located?.path ?? 'jj', logger)
  runner.onWarning((warning) => void host.ui.warn(`jj: ${warning.text}`))
  const availability = { isAvailable: located !== null }
  updateTerminalPath(context, located)

  const registry = new RepoRegistry(runner, logger, host)
  const operations = new Operations(logger)
  const graphView = new GraphView(context.extensionUri, registry, operations, availability, logger)
  const selection = new ChangeSelection()
  void vscode.commands.executeCommand('setContext', EVOLUTION_FOLLOWING, selection.isFollowing)
  const unfollow = selection.onDidChange(() => {
    void vscode.commands.executeCommand('setContext', EVOLUTION_FOLLOWING, selection.isFollowing)
  })
  const evolutionView = new EvolutionView(registry, selection, logger)
  const workspacesView = new WorkspacesView(registry)
  const operationsView = new OperationsView(registry)
  const fileHistoryView = new FileHistoryView(registry, logger)
  const bookmarksView = new BookmarksView(registry)
  const forge = new ForgeService(registry, host, logger, vscodeForgeAccounts(context.extension.id))
  const askpass = new AskpassServer(
    process.execPath,
    [vscode.Uri.joinPath(context.extensionUri, 'dist', 'askpass.js').fsPath],
    (request) => runner.whilePrompting(() => forge.gitCredential(request)),
    (request) => runner.whilePrompting(() => answerPrompt(host.ui, request)),
  )
  try {
    await askpass.start()
    runner.setEnvironment(askpass.env)
  } catch (error) {
    logger.warn(`git sign-in over HTTPS is not available: ${errorMessage(error)}`)
  }
  const autoFetch = new AutoFetcher(registry, forge, operations, logger, host)

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
  const install = async () => {
    if (await installJj(storageDir, logger)) {
      await reloadJj()
    }
  }

  const env: CommandEnv = {
    registry,
    operations,
    graphView,
    forge,
    runner,
    logger,
    selection,
    autoFetch,
    ui: host.ui,
    settings,
    folders: host.folders,
    workbench: vscodeWorkbench(
      {
        extensionId: context.extension.id,
        extensionUri: context.extensionUri,
        storageUri: context.globalStorageUri,
      },
      () => env,
      install,
      () => fileHistoryView,
    ),
    suggestions: new DescriptionSuggestions(
      [...cliSuggesters(settings), new LanguageModelSuggester(settings)],
      settings,
    ),
  }
  graphView.setHandler(
    createMessageHandler(env, async (command, args) => {
      await vscode.commands.executeCommand(command, args)
    }),
  )
  const conflictDecorator = new ConflictDecorator(registry)
  const inlineBlame = new InlineBlame(registry, logger)

  context.subscriptions.push(
    channel,
    settings,
    askpass,
    autoFetch,
    registry,
    operations,
    graphView,
    evolutionView,
    selection,
    { dispose: unfollow },
    forge,
    new ScmController(registry),
    new RepoStatusBar(registry),
    registerConflictLenses(registry),
    conflictDecorator,
    workspacesView,
    operationsView,
    fileHistoryView,
    inlineBlame,
    bookmarksView,
    vscode.window.registerTreeDataProvider('ukemi.workspaces', workspacesView),
    vscode.window.registerTreeDataProvider('ukemi.operations', operationsView),
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
    settings.onDidChange(async (change) => {
      if (affectsJj(change, [...JJ_SETTINGS, 'addJjToTerminalPath'])) {
        await reloadJj()
      } else {
        await applyRepositorySettings(change, registry)
      }
    }),
  )

  registerAll(context, {
    ...globalCommands(env),
    ...commitCommands(env),
    ...fileCommands(env),
    ...editorFileCommands(env),
    ...viewCommands(graphView),
    ...conflictCommands(env),
    ...conflictDecorator.commands(),
    ...refCommands(env),
    ...workspaceCommands(env),
    ...evolutionCommands(env),
    ...operationCommands(env),
    ...fileHistoryCommands(env),
    ...inlineBlame.commands(),
    'ukemi.evolution.follow': () => {
      selection.toggleFollow(evolutionView.currentSelection())
    },
    'ukemi.bookmarks.filter': () => bookmarksView.promptFilter(),
    'ukemi.bookmarks.clearFilter': () => bookmarksView.clearFilter(),
    'ukemi.showLog': () => {
      void showLog(channel, context.extension.id, context.storageUri, context.logUri)
    },
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
