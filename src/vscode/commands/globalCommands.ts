import { basename } from 'node:path'
import * as vscode from 'vscode'
import type { ChangedFilesView } from '../../../shared/protocol'
import { JjRepo } from '../../jj/repo'
import type { RepoModel } from '../../repo/repoModel'
import {
  bookmarkGoToItems,
  bookmarkRefsFromList,
  resolveBookmarkGoTo,
} from '../../repo/goToTargets'
import { collectBookmarks, type BookmarkRef } from '../../repo/workspaceItems'
import { errorMessage } from '../../util/logger'
import { openCommitDiff } from '../diff'
import { GRAPH_VIEW_ID } from '../graphView'
import { readConfig, updateUkemiSetting } from '../config'
import { openCleanupPanel } from '../cleanupPanel'
import { showForgeMissing } from '../forgeMissing'
import { openSettings } from '../openSettings'
import { contextModel, parseContext, type CommandEnv, type Handler } from './context'

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

type GoToItem = vscode.QuickPickItem & {
  revision?: string
  bookmarkName?: string
  workspaceRoot?: string
}

function goToItems(
  model: RepoModel,
  local: readonly BookmarkRef[],
  remote: readonly BookmarkRef[],
): GoToItem[] {
  const commits = model.graph?.commits ?? []
  const bookmarks = bookmarkGoToItems(local, remote).map((item) => ({
    label: item.label,
    description: item.description,
    bookmarkName: item.name,
    ...(item.revision ? { revision: item.revision } : {}),
  }))
  const requests = commits.flatMap((commit) =>
    commit.requests.map((request) => ({
      label: `$(git-pull-request) #${request.number} ${request.title}`,
      revision: commit.commitId,
    })),
  )
  const workspaces = (model.graph?.workspaces ?? [])
    .filter((workspace) => workspace.root && workspace.root !== model.root)
    .map((workspace) => ({
      label: `$(folder) ${workspace.name}`,
      description: 'workspace',
      workspaceRoot: workspace.root ?? undefined,
    }))
  return [...bookmarks, ...requests, ...workspaces]
}

interface GoToPick {
  choice: Promise<GoToItem | string | undefined>
  update: (items: readonly GoToItem[]) => void
}

function showGoToPick(items: readonly GoToItem[]): GoToPick {
  const pick = vscode.window.createQuickPick<GoToItem>()
  pick.title = 'Go to branch, request or workspace'
  pick.placeholder = 'Starts a new change on the target. Type a change id or revset to jump there.'
  pick.matchOnDescription = true
  pick.items = [...items]
  let disposed = false
  const choice = new Promise<GoToItem | string | undefined>((resolve) => {
    pick.onDidAccept(() => {
      resolve(pick.selectedItems[0] ?? (pick.value.trim() || undefined))
      pick.hide()
    })
    pick.onDidHide(() => {
      disposed = true
      resolve(undefined)
      pick.dispose()
    })
    pick.show()
  })
  return {
    choice,
    update(next) {
      if (!disposed) {
        pick.items = [...next]
      }
    },
  }
}

async function chooseBookmarkRevision(
  name: string,
  local: readonly BookmarkRef[],
  remote: readonly BookmarkRef[],
): Promise<string | undefined> {
  const resolved = resolveBookmarkGoTo(name, local, remote)
  if (resolved.kind === 'single') {
    return resolved.revision
  }
  if (resolved.kind !== 'ambiguous') {
    return undefined
  }
  const picked = await vscode.window.showQuickPick<vscode.QuickPickItem & { revision: string }>(
    resolved.choices.map((choice) => ({ label: choice.label, revision: choice.revision })),
    { title: `Go to ${name}` },
  )
  return picked?.revision
}

async function resolveGoToRevision(
  choice: GoToItem | string,
  local: readonly BookmarkRef[],
  remote: readonly BookmarkRef[],
): Promise<string | undefined> {
  if (typeof choice === 'string') {
    const resolved = resolveBookmarkGoTo(choice, local, remote)
    if (resolved.kind === 'unknown') {
      return choice
    }
    if (resolved.kind === 'single') {
      return resolved.revision
    }
    return chooseBookmarkRevision(choice, local, remote)
  }
  if (choice.revision) {
    return choice.revision
  }
  if (!choice.bookmarkName) {
    return undefined
  }
  return chooseBookmarkRevision(choice.bookmarkName, local, remote)
}

async function goToBookmarks(
  env: CommandEnv,
  model: RepoModel,
): Promise<{ local: BookmarkRef[]; remote: BookmarkRef[] }> {
  try {
    return bookmarkRefsFromList(await model.repo.bookmarkList())
  } catch (error: unknown) {
    env.logger.warn(`Go to bookmark list failed: ${errorMessage(error)}`)
    return collectBookmarks(model.graph?.commits ?? [])
  }
}

async function goTo(env: CommandEnv, model: RepoModel): Promise<void> {
  const visible = collectBookmarks(model.graph?.commits ?? [])
  const pick = showGoToPick(goToItems(model, visible.local, visible.remote))
  const listed = goToBookmarks(env, model)
  void listed.then((bookmarks) => {
    pick.update(goToItems(model, bookmarks.local, bookmarks.remote))
  })
  const choice = await pick.choice
  if (!choice) {
    return
  }
  if (typeof choice !== 'string' && choice.workspaceRoot) {
    await vscode.commands.executeCommand(
      'vscode.openFolder',
      vscode.Uri.file(choice.workspaceRoot),
      { forceNewWindow: true },
    )
    return
  }
  const { local, remote } = typeof choice !== 'string' && choice.revision ? visible : await listed
  const revision = await resolveGoToRevision(choice, local, remote)
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
    'ukemi.cleanup': async (arg?: unknown) => {
      const model = contextModel(env, parseContext(arg))
      if (!model) {
        void vscode.window.showWarningMessage('Ukemi: no jj repository is active.')
        return
      }
      openCleanupPanel(env, model)
    },
    'ukemi.openCommitDiff': withModel(env, async (model) => {
      const commit = model.graph?.commits.find((c) => c.isWorkingCopy)
      if (commit) {
        await openCommitDiff(model, commit, model.graph?.workingCopyFiles ?? [])
      }
    }),
    'ukemi.forge.signIn': withModel(env, async (model) => {
      if (!(await env.forge.target(model))) {
        await showForgeMissing(model, env)
        return
      }
      const client = await env.forge.signIn(model)
      if (!client) {
        void vscode.window.showWarningMessage('Ukemi: sign-in was cancelled.')
        return
      }
      await env.forge.refreshRequests(model, { force: true })
    }),
    'ukemi.forge.signOut': withModel(env, (model) => env.forge.signOut(model)),
    'ukemi.openSettings': () => {
      openSettings(`@ext:${env.extensionId}`)
    },
    'ukemi.view.asList': () => setChangedFilesView('list'),
    'ukemi.view.asTree': () => setChangedFilesView('tree'),
  }
}
