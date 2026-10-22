import * as vscode from 'vscode'
import { JjRunner } from './jj/runner'
import { commitCommands } from './vscode/commands/commitCommands'
import { contextCommit, registerAll, type CommandEnv } from './vscode/commands/context'
import { fileCommands } from './vscode/commands/fileCommands'
import { globalCommands } from './vscode/commands/globalCommands'
import { refCommands } from './vscode/commands/refCommands'
import { DIFF_SCHEME, RevisionContentProvider } from './vscode/diff'
import { ForgeService } from './vscode/forgeService'
import { GRAPH_VIEW_ID, GraphView } from './vscode/graphView'
import { installJj, locateJj, offerInstall, updateTerminalPath } from './vscode/jjSetup'
import { Operations } from './vscode/operations'
import { createOutputLogger } from './vscode/outputLogger'
import { RepoRegistry } from './vscode/registry'
import { ScmController } from './vscode/scm'
import { openSplitPanel } from './vscode/splitPanel'
import { RepoStatusBar } from './vscode/statusBar'
import { createMessageHandler } from './vscode/webviewMessages'

export async function activate(context: vscode.ExtensionContext): Promise<void> {
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
  const forge = new ForgeService(registry, context.secrets, logger)
  const env: CommandEnv = {
    registry,
    operations,
    graphView,
    forge,
    runner,
    logger,
    extensionUri: context.extensionUri,
    storageUri: context.globalStorageUri,
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
    registry,
    operations,
    graphView,
    forge,
    new ScmController(registry),
    new RepoStatusBar(registry),
    vscode.window.registerWebviewViewProvider(GRAPH_VIEW_ID, graphView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, new RevisionContentProvider(registry)),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('ukemi.jjPath') || e.affectsConfiguration('ukemi.addJjToTerminalPath')) {
        await reloadJj()
      } else if (e.affectsConfiguration('ukemi.repoScanDepth') || e.affectsConfiguration('ukemi.repoScanExclude')) {
        await registry.discover()
      }
    }),
  )

  registerAll(context, {
    ...globalCommands(env),
    ...commitCommands(env),
    ...fileCommands(env),
    ...refCommands(env),
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
}

export function deactivate(): void {
  return undefined
}
