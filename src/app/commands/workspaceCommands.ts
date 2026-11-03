import { rm } from 'node:fs/promises'
import { bookmarkRevision } from '../../jj/revsets'
import { basename, dirname, join } from 'node:path'
import type { Workspace } from '../../../shared/model'
import type { RepoModel } from '../../repo/repoModel'
import { isBookmarkTreeElement } from '../../repo/bookmarkItems'
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
import type { PickItem } from '../ui'
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

type BasePick = PickItem & WorkspaceBaseItem

function findWorkspace(model: RepoModel, name: string): Workspace | undefined {
  return model.graph?.workspaces.find((workspace) => workspace.name === name)
}

function workspaceTarget(env: CommandEnv, arg: unknown): { model: RepoModel; name: string } | null {
  if (isWorkspaceTreeElement(arg)) {
    const model = env.registry.modelFor(arg.repoId) ?? env.registry.activeModel
    return model ? { model, name: arg.workspace.name } : null
  }
  const ctx = parseContext(arg)
  const model = contextModel(env, ctx)
  return model && ctx.workspace ? { model, name: ctx.workspace } : null
}

function bookmarkWorkspace(
  arg: unknown,
): { repoId: string | undefined; name: string; remote: string | undefined } | null {
  if (isBookmarkTreeElement(arg)) {
    if (!arg.commitId) {
      return null
    }
    return { repoId: arg.repoId, name: arg.name, remote: arg.remote ?? undefined }
  }
  const ctx = parseContext(arg)
  if (!ctx.bookmark) {
    return null
  }
  return { repoId: ctx.repoId, name: ctx.bookmark, remote: ctx.remote }
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

function folderPaths(env: CommandEnv): string[] {
  return env.folders.folders().map((folder) => folder.path)
}

async function pickBase(env: CommandEnv, model: RepoModel): Promise<WorkspaceBase | undefined> {
  const choice = await env.ui.pickOrType<BasePick>(workspaceBaseItems(model.graph), {
    title: 'Workspace base',
    placeholder: 'Choose a bookmark, or type a change id or revset.',
  }).choice
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
  const chosen = base ?? (await pickBase(env, model))
  if (!chosen) {
    return
  }
  const name = await env.ui.input({
    title: 'Create workspace',
    prompt: `New empty change on ${chosen.shown}. That revision is not changed. The folder is a sibling of ${basename(model.root)}.`,
    value: chosen.suggestedName.length > 0 ? chosen.suggestedName : undefined,
    validate: validateBookmarkName,
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
  const open = await env.ui.info(`Workspace "${name}" created in ${path}.`, 'Open in New Window')
  if (open) {
    await env.workbench.openWindow(path)
  }
}

async function openHere(env: CommandEnv, model: RepoModel, name: string): Promise<void> {
  const workspace = findWorkspace(model, name)
  const root = workspace?.root
  if (!root) {
    void env.ui.warn(`Workspace "${name}" has no working copy on disk.`)
    return
  }
  const folders = folderPaths(env)
  if (isWorkspaceOpen(root, folders)) {
    void env.ui.info(`Workspace "${name}" is already open in this window.`)
    return
  }
  if (workspaceNesting(root, folders)) {
    const choice = await env.ui.ask(
      'warning',
      `Add workspace "${name}" to this window?`,
      {
        detail:
          'The folder is nested with an open folder. Files appear twice and the outer working copy may track them.',
      },
      'Add Anyway',
      'Open in New Window',
    )
    if (choice === 'Open in New Window') {
      await env.workbench.openWindow(root)
    }
    if (choice !== 'Add Anyway') {
      return
    }
  }
  if (!env.workbench.addFolder(root, name)) {
    void env.ui.error('Ukemi: could not add the workspace folder.')
  }
}

async function revealWorkspace(env: CommandEnv, model: RepoModel, name: string): Promise<void> {
  const workspace = findWorkspace(model, name)
  if (!workspace) {
    return
  }
  if (!model.findCommit(workspace.commitId)) {
    void env.ui.info(
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
  const choice = await env.ui.ask(
    'warning',
    `Delete workspace "${name}"?`,
    {
      detail: canDeleteFiles ? `Files in ${workspace.root} can also be deleted.` : undefined,
    },
    ...(canDeleteFiles ? ['Forget and Delete Files'] : []),
    'Forget Only',
  )
  if (!choice) {
    return
  }
  const forgotten = await env.operations.run('Delete workspace', model, async () => {
    await model.repo.forgetWorkspace(name)
    if (choice === 'Forget and Delete Files' && workspace.root) {
      await rm(workspace.root, { recursive: true, force: true })
    }
    return true
  })
  if (forgotten && workspace.root && !sameFolder(workspace.root, model.root)) {
    await env.registry.remove(workspace.root)
  }
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
  const onWorkspace = (fn: (model: RepoModel, name: string) => Promise<unknown>): Handler =>
    workspaceHandler(env, fn)

  return {
    'ukemi.addWorkspace': async () => {
      const model = env.registry.activeModel
      if (!model) {
        void env.ui.warn('Ukemi: no jj repository is active.')
        return
      }
      await addWorkspace(env, model)
    },
    'ukemi.workspaces.refreshAll': async () => {
      const model = env.registry.activeModel
      if (!model) {
        void env.ui.warn('Ukemi: no jj repository is active.')
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
      const picked = bookmarkWorkspace(arg)
      if (!picked) {
        return
      }
      const model =
        (picked.repoId ? env.registry.modelFor(picked.repoId) : null) ?? env.registry.activeModel
      if (!model) {
        return
      }
      await addWorkspace(env, model, {
        revision: bookmarkRevision(picked.name, picked.remote),
        suggestedName: picked.name,
        shown: picked.remote ? `${picked.name}@${picked.remote}` : picked.name,
      })
    },
    'ukemi.workspace.openHere': onWorkspace((model, name) => openHere(env, model, name)),
    'ukemi.workspace.open': onWorkspace(async (model, name) => {
      const root = findWorkspace(model, name)?.root
      if (root) {
        await env.workbench.openWindow(root)
      }
    }),
    'ukemi.workspace.openTerminal': onWorkspace(async (model, name) => {
      const root = findWorkspace(model, name)?.root
      if (!root) {
        return
      }
      env.workbench.openTerminal(root, `jj: ${name}`)
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
        await env.ui.copy(root)
      }
    }),
    'ukemi.workspace.delete': onWorkspace((model, name) => deleteWorkspace(env, model, name)),
  }
}
