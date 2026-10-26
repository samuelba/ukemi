import { basename } from 'node:path'
import * as vscode from 'vscode'
import type { ChangedFilesView } from '../../../shared/protocol'
import { JjRepo } from '../../jj/repo'
import type { RepoModel } from '../../repo/repoModel'
import { collectBookmarks } from '../../repo/workspaceItems'
import { errorMessage } from '../../util/logger'
import { openCommitDiff } from '../diff'
import { GRAPH_VIEW_ID } from '../graphView'
import { readConfig, updateUkemiSetting } from '../config'
import { type CommandEnv, type Handler } from './context'

function activeOrWarn(env: CommandEnv): RepoModel | null {
  const model = env.registry.activeModel
  if (!model) {
    void vscode.window.showWarningMessage('Ukemi: no jj repository is active.')
  }
  return model
}

function withModel(env: CommandEnv, fn: (model: RepoModel) => Promise<unknown>): Handler {
  return async () => {
    const model = activeOrWarn(env)
    if (model) {
      await fn(model)
    }
  }
}

async function selectRepository(env: CommandEnv): Promise<void> {
  const repos = env.registry.summaries()
  const pick = await vscode.window.showQuickPick(
    repos.map((r) => ({
      label: r.label,
      description:
        r.kind === 'git'
          ? 'Git only, not initialized for jj'
          : r.changedFiles
            ? `${r.changedFiles} changed`
            : '',
      detail: r.id,
      id: r.id,
      repoKind: r.kind,
    })),
    { title: 'Select repository', matchOnDetail: true },
  )
  if (!pick) {
    return
  }
  if (pick.repoKind === 'git') {
    await initRepo(env, pick.id)
    return
  }
  await env.registry.setActive(pick.id)
}

export async function initRepo(env: CommandEnv, root?: string): Promise<void> {
  const folder =
    root ??
    (
      await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        openLabel: 'Initialize jj',
      })
    )?.[0]?.fsPath
  if (!folder) {
    return
  }
  const proceed = await vscode.window.showInformationMessage(
    `Initialize a colocated jj repository in ${basename(folder)}?`,
    { modal: true, detail: 'The Git repository stays usable with Git tools.' },
    'Initialize',
  )
  if (proceed !== 'Initialize') {
    return
  }
  try {
    await JjRepo.initColocated(env.runner, folder)
    await env.registry.addRepo(folder)
  } catch (error: unknown) {
    void vscode.window.showErrorMessage(`Ukemi: jj init failed: ${errorMessage(error)}`)
  }
}

async function goTo(env: CommandEnv, model: RepoModel): Promise<void> {
  const graph = model.graph
  type Item = vscode.QuickPickItem & { revision?: string; workspaceRoot?: string }
  const { local, remote } = collectBookmarks(graph?.commits ?? [])
  const bookmarks: Item[] = [
    ...local.map((bookmark) => ({
      label: `$(bookmark) ${bookmark.name}`,
      revision: bookmark.commitId,
    })),
    ...remote.map((bookmark) => ({
      label: `$(cloud) ${bookmark.name}@${bookmark.remote}`,
      revision: bookmark.commitId,
    })),
  ]
  const requests: Item[] = (graph?.commits ?? []).flatMap((c) =>
    c.requests.map((r) => ({
      label: `$(git-pull-request) #${r.number} ${r.title}`,
      revision: c.commitId,
    })),
  )
  const workspaces: Item[] = (graph?.workspaces ?? [])
    .filter((w) => w.root && w.root !== model.root)
    .map((w) => ({
      label: `$(folder) ${w.name}`,
      description: 'workspace',
      workspaceRoot: w.root ?? undefined,
    }))

  const pick = vscode.window.createQuickPick<Item>()
  pick.title = 'Go to branch, request or workspace'
  pick.placeholder = 'Starts a new change on the target. Type a change id or revset to jump there.'
  pick.items = [...bookmarks, ...requests, ...workspaces]
  const choice = await new Promise<Item | string | undefined>((resolve) => {
    pick.onDidAccept(() => {
      resolve(pick.selectedItems[0] ?? (pick.value.trim() || undefined))
      pick.hide()
    })
    pick.onDidHide(() => {
      resolve(undefined)
      pick.dispose()
    })
    pick.show()
  })
  if (!choice) {
    return
  }
  if (typeof choice !== 'string' && choice.workspaceRoot) {
    await vscode.commands.executeCommand(
      'vscode.openFolder',
      vscode.Uri.file(choice.workspaceRoot),
      {
        forceNewWindow: true,
      },
    )
    return
  }
  const revision = typeof choice === 'string' ? choice : choice.revision
  if (revision) {
    await env.operations.run('Go to', model, () => model.repo.newChange([revision]))
  }
}

function setChangedFilesView(view: ChangedFilesView): Promise<void> {
  return updateUkemiSetting('changedFilesView', view)
}

export function globalCommands(env: CommandEnv): Record<string, Handler> {
  return {
    'ukemi.refresh': withModel(env, (model) =>
      env.operations.track('Refreshing', async () => {
        model.markDirty()
        await model.refresh()
        await env.forge.refreshRequests(model, { force: true })
      }),
    ),
    'ukemi.openView': async () => {
      if (readConfig().showInPanel) {
        env.graphView.openPanel()
        return
      }
      await vscode.commands.executeCommand(`${GRAPH_VIEW_ID}.focus`)
    },
    'ukemi.openPanel': async () => env.graphView.openPanel(),
    'ukemi.selectRepository': () => selectRepository(env),
    'ukemi.initRepo': (arg?: unknown) => initRepo(env, typeof arg === 'string' ? arg : undefined),
    'ukemi.fetch': withModel(env, async (model) => {
      const result = await env.operations.run('Fetch', model, () => model.repo.fetch())
      if (result) {
        env.autoFetch.recordFetch(model.root)
      }
      await env.forge.refreshRequests(model, { force: true })
    }),
    'ukemi.toggleAutoFetch': () =>
      updateUkemiSetting('autoFetch.enabled', !readConfig().autoFetchEnabled),
    'ukemi.toggleGitTags': () => updateUkemiSetting('showGitTags', !readConfig().showGitTags),
    'ukemi.push': withModel(env, (model) =>
      env.operations.run('Push', model, () => model.repo.push()),
    ),
    'ukemi.pushCurrent': withModel(env, async (model) => {
      const names = model.graph?.currentBookmarks ?? []
      if (names.length === 0) {
        void vscode.window.showInformationMessage(
          'Ukemi: the current change and its mutable ancestors have no bookmark.',
        )
        return
      }
      await env.operations.run(`Push ${names.join(', ')}`, model, () => model.repo.push(names))
    }),
    'ukemi.undo': withModel(env, (model) =>
      env.operations.run('Undo', model, () => model.repo.undo()),
    ),
    'ukemi.redo': withModel(env, async (model) => {
      if (model.graph?.canRedo === false) {
        void vscode.window.showInformationMessage('Ukemi: nothing to redo.')
        return
      }
      await env.operations.run('Redo', model, () => model.repo.redo())
    }),
    'ukemi.newFromTrunk': withModel(env, (model) =>
      env.operations.run('New change from trunk', model, () => model.repo.newChange(['trunk()'])),
    ),
    'ukemi.goTo': withModel(env, (model) => goTo(env, model)),
    'ukemi.openCommitDiff': withModel(env, async (model) => {
      const commit = model.graph?.commits.find((c) => c.isWorkingCopy)
      if (commit) {
        await openCommitDiff(model, commit, model.graph?.workingCopyFiles ?? [])
      }
    }),
    'ukemi.forge.signIn': withModel(env, async (model) => {
      const client = await env.forge.signIn(model)
      if (!client) {
        void vscode.window.showWarningMessage(
          'Ukemi: no GitHub or GitLab remote found for this repository.',
        )
        return
      }
      await env.forge.refreshRequests(model, { force: true })
    }),
    'ukemi.forge.signOut': withModel(env, (model) => env.forge.signOut(model)),
    'ukemi.openSettings': () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ukemi.ukemi'),
    'ukemi.view.asList': () => setChangedFilesView('list'),
    'ukemi.view.asTree': () => setChangedFilesView('tree'),
  }
}
