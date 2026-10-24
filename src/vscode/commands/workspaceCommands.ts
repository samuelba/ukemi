import { rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import * as vscode from 'vscode'
import type { Workspace } from '../../../shared/model'
import type { RepoModel } from '../../repo/repoModel'
import {
  defaultWorkspaceName,
  isWorkspaceOpen,
  isWorkspaceTreeElement,
  sameFolder,
  suggestedWorkspaceName,
  workspaceBaseItems,
  workspaceNesting,
  type WorkspaceBaseItem,
} from '../../repo/workspaceItems'
import { validateBookmarkName } from '../../util/text'
import {
  contextCommit,
  contextModel,
  parseContext,
  shortId,
  type CommandEnv,
  type Handler,
} from './context'

interface WorkspaceBase {
  revision: string
  suggestedName: string
  shown: string
}

type BasePick = vscode.QuickPickItem & WorkspaceBaseItem

function findWorkspace(model: RepoModel, name: string): Workspace | undefined {
  return model.graph?.workspaces.find((workspace) => workspace.name === name)
}

function workspaceTarget(
  env: CommandEnv,
  arg: unknown,
): { model: RepoModel; name: string } | null {
  if (isWorkspaceTreeElement(arg)) {
    const model = env.registry.modelFor(arg.repoId) ?? env.registry.activeModel
    return model ? { model, name: arg.workspace.name } : null
  }
  const ctx = parseContext(arg)
  const model = contextModel(env, ctx)
  return model && ctx.workspace ? { model, name: ctx.workspace } : null
}

function workspaceHandler(
  env: CommandEnv,
  fn: (model: RepoModel, name: string) => Promise<unknown>,
): Handler {
  return async (arg?: unknown) => {
    const target = workspaceTarget(env, arg)
    if (target) {
      await fn(target.model, target.name)
    }
  }
}

function folderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath)
}

async function openInNewWindow(root: string): Promise<void> {
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), {
    forceNewWindow: true,
  })
}

function acceptPick(pick: vscode.QuickPick<BasePick>): Promise<BasePick | string | undefined> {
  return new Promise((resolve) => {
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
}

async function pickBase(model: RepoModel): Promise<WorkspaceBase | undefined> {
  const pick = vscode.window.createQuickPick<BasePick>()
  pick.title = 'Workspace base'
  pick.placeholder = 'Choose a bookmark, or type a change id or revset.'
  pick.items = workspaceBaseItems(model.graph)
  const choice = await acceptPick(pick)
  if (!choice) {
    return undefined
  }
  if (typeof choice === 'string') {
    return { revision: choice, suggestedName: defaultWorkspaceName(choice), shown: choice }
  }
  return { revision: choice.revision, suggestedName: choice.suggestedName, shown: choice.shown }
}

export async function addWorkspace(
  env: CommandEnv,
  model: RepoModel,
  base?: WorkspaceBase,
): Promise<void> {
  const chosen = base ?? (await pickBase(model))
  if (!chosen) {
    return
  }
  const name = await vscode.window.showInputBox({
    title: 'Create workspace',
    prompt: `New empty change on ${chosen.shown}. That revision is not changed. The folder is a sibling of ${basename(model.root)}.`,
    value: chosen.suggestedName.length > 0 ? chosen.suggestedName : undefined,
    validateInput: validateBookmarkName,
  })
  if (!name) {
    return
  }
  const path = join(dirname(model.root), `${basename(model.root)}-${name}`)
  const created = await env.operations.run('Create workspace', model, async () => {
    await model.repo.addWorkspace(path, name, chosen.revision)
    return true
  })
  if (!created) {
    return
  }
  const open = await vscode.window.showInformationMessage(
    `Workspace "${name}" created in ${path}.`,
    'Open in New Window',
  )
  if (open) {
    await openInNewWindow(path)
  }
}

async function openHere(model: RepoModel, name: string): Promise<void> {
  const workspace = findWorkspace(model, name)
  const root = workspace?.root
  if (!root) {
    void vscode.window.showWarningMessage(`Workspace "${name}" has no working copy on disk.`)
    return
  }
  const folders = folderPaths()
  if (isWorkspaceOpen(root, folders)) {
    void vscode.window.showInformationMessage(`Workspace "${name}" is already open in this window.`)
    return
  }
  if (workspaceNesting(root, folders)) {
    const choice = await vscode.window.showWarningMessage(
      `Add workspace "${name}" to this window?`,
      {
        modal: true,
        detail:
          'The folder is nested with an open folder. Files appear twice and the outer working copy may track them.',
      },
      'Add Anyway',
      'Open in New Window',
    )
    if (choice === 'Open in New Window') {
      await openInNewWindow(root)
    }
    if (choice !== 'Add Anyway') {
      return
    }
  }
  const added = vscode.workspace.updateWorkspaceFolders(folders.length, 0, {
    uri: vscode.Uri.file(root),
    name,
  })
  if (!added) {
    void vscode.window.showErrorMessage('Ukemi: could not add the workspace folder.')
  }
}

async function revealWorkspace(env: CommandEnv, model: RepoModel, name: string): Promise<void> {
  const workspace = findWorkspace(model, name)
  if (!workspace) {
    return
  }
  if (!model.findCommit(workspace.commitId)) {
    void vscode.window.showInformationMessage(
      'Ukemi: that change is outside the current graph. Widen the history filter and try again.',
    )
    return
  }
  await env.graphView.showCommit(workspace.commitId)
}

async function deleteWorkspace(env: CommandEnv, model: RepoModel, name: string): Promise<void> {
  const workspace = findWorkspace(model, name)
  if (!workspace || name === 'default') {
    return
  }
  const canDeleteFiles = workspace.root !== null && workspace.root !== model.root
  const choice = await vscode.window.showWarningMessage(
    `Delete workspace "${name}"?`,
    {
      modal: true,
      detail: canDeleteFiles ? `Files in ${workspace.root} can also be deleted.` : undefined,
    },
    ...(canDeleteFiles ? ['Forget and Delete Files'] : []),
    'Forget Only',
  )
  if (!choice) {
    return
  }
  await env.operations.run('Delete workspace', model, async () => {
    await model.repo.forgetWorkspace(name)
    if (choice === 'Forget and Delete Files' && workspace.root) {
      await rm(workspace.root, { recursive: true, force: true })
    }
  })
}

async function refreshAll(env: CommandEnv, model: RepoModel): Promise<void> {
  await env.operations.run('Refresh workspaces', model, async () => {
    const listed = model.graph?.workspaces ?? (await model.repo.workspaces())
    for (const workspace of listed) {
      if (workspace.root && !sameFolder(workspace.root, model.root)) {
        await model.repo.snapshotWorkspace(workspace.root)
      }
    }
  })
}

export function workspaceCommands(env: CommandEnv): Record<string, Handler> {
  const onWorkspace = (
    fn: (model: RepoModel, name: string) => Promise<unknown>,
  ): Handler => workspaceHandler(env, fn)

  return {
    'ukemi.addWorkspace': async () => {
      const model = env.registry.activeModel
      if (!model) {
        void vscode.window.showWarningMessage('Ukemi: no jj repository is active.')
        return
      }
      await addWorkspace(env, model)
    },
    'ukemi.workspaces.refreshAll': async () => {
      const model = env.registry.activeModel
      if (!model) {
        void vscode.window.showWarningMessage('Ukemi: no jj repository is active.')
        return
      }
      await refreshAll(env, model)
    },
    'ukemi.commit.newWorkspace': async (arg?: unknown) => {
      const target = contextCommit(env, arg)
      if (!target) {
        return
      }
      const suggestedName = suggestedWorkspaceName(target.commit.commitId, target.commit)
      await addWorkspace(env, target.model, {
        revision: target.commit.commitId,
        suggestedName,
        shown: target.commit.localBookmarks[0]?.name ?? shortId(target.commit),
      })
    },
    'ukemi.bookmark.newWorkspace': async (arg?: unknown) => {
      const ctx = parseContext(arg)
      const model = contextModel(env, ctx)
      if (!model || !ctx.bookmark) {
        return
      }
      const revision = ctx.remote ? `${ctx.bookmark}@${ctx.remote}` : ctx.bookmark
      await addWorkspace(env, model, {
        revision,
        suggestedName: ctx.bookmark,
        shown: revision,
      })
    },
    'ukemi.workspace.openHere': onWorkspace((model, name) => openHere(model, name)),
    'ukemi.workspace.open': onWorkspace(async (model, name) => {
      const root = findWorkspace(model, name)?.root
      if (root) {
        await openInNewWindow(root)
      }
    }),
    'ukemi.workspace.openTerminal': onWorkspace(async (model, name) => {
      const root = findWorkspace(model, name)?.root
      if (!root) {
        return
      }
      const terminal = vscode.window.createTerminal({ cwd: root, name: `jj: ${name}` })
      terminal.show()
    }),
    'ukemi.workspace.snapshot': onWorkspace(async (model, name) => {
      const root = findWorkspace(model, name)?.root
      if (!root) {
        return
      }
      await env.operations.run(`Refresh ${name}`, model, () => model.repo.snapshotWorkspace(root))
    }),
    'ukemi.workspace.reveal': onWorkspace((model, name) => revealWorkspace(env, model, name)),
    'ukemi.workspace.newChange': onWorkspace(async (model, name) => {
      const root = findWorkspace(model, name)?.root
      if (root) {
        await env.operations.run('New change', model, () => model.repo.newChangeInWorkspace(root))
      }
    }),
    'ukemi.workspace.copyPath': onWorkspace(async (model, name) => {
      const root = findWorkspace(model, name)?.root
      if (root) {
        await vscode.env.clipboard.writeText(root)
      }
    }),
    'ukemi.workspace.delete': onWorkspace((model, name) => deleteWorkspace(env, model, name)),
  }
}
