import { rm } from 'node:fs/promises'
import * as vscode from 'vscode'
import type { CommitView, RequestBadge } from '../../../shared/protocol'
import { quoteRevsetString } from '../../jj/revsets'
import type { MergeMethod } from '../../forge/types'
import type { RepoModel } from '../../repo/repoModel'
import { bodyAfterTitle, bookmarkSlug, firstLine, validateBookmarkName } from '../../util/text'
import {
  confirm,
  contextCommit,
  contextModel,
  parseContext,
  shortId,
  type CommandEnv,
  type Handler,
} from './context'

function bookmarkHandler(
  env: CommandEnv,
  fn: (model: RepoModel, name: string, remote: string | undefined) => Promise<unknown>,
): Handler {
  return async (arg?: unknown) => {
    const ctx = parseContext(arg)
    const model = contextModel(env, ctx)
    if (model && ctx.bookmark) {
      await fn(model, ctx.bookmark, ctx.remote)
    }
  }
}

function requestFor(
  model: RepoModel,
  ctx: ReturnType<typeof parseContext>,
): RequestBadge | undefined {
  return model.graph?.commits.flatMap((c) => c.requests).find((r) => r.number === ctx.number)
}

function requestHandler(
  env: CommandEnv,
  fn: (model: RepoModel, request: RequestBadge) => Promise<unknown>,
): Handler {
  return async (arg?: unknown) => {
    const ctx = parseContext(arg)
    const model = contextModel(env, ctx)
    const request = model ? requestFor(model, ctx) : undefined
    if (model && request) {
      await fn(model, request)
    }
  }
}

function reusableBookmark(commit: CommitView, trunk: string | null): string | undefined {
  return commit.localBookmarks.map((b) => b.name).find((name) => name !== trunk)
}

async function askBookmarkName(commit: CommitView): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: 'Branch name for the request',
    value: bookmarkSlug(commit.description, commit.changeId),
    validateInput: validateBookmarkName,
  })
}

async function createRequest(env: CommandEnv, arg: unknown, askName: boolean): Promise<void> {
  const target = contextCommit(env, arg)
  if (!target) {
    return
  }
  const { model, commit } = target
  if (!commit.description.trim()) {
    void vscode.window.showWarningMessage('Ukemi: describe the change before creating a request.')
    return
  }
  const client = await env.forge.client(model, true)
  if (!client) {
    void vscode.window.showWarningMessage(
      'Ukemi: no GitHub or GitLab remote found, or sign-in was cancelled. Add self-hosted GitLab hosts to "ukemi.gitlab.hosts".',
    )
    return
  }
  const trunk = model.graph?.trunkName ?? 'main'
  const existing = reusableBookmark(commit, trunk)
  const name = askName || !existing ? await askBookmarkName(commit) : existing
  if (!name) {
    return
  }
  const kind = await vscode.window.showQuickPick(['Ready for review', 'Draft'], {
    title: `Create request for ${shortId(commit)} into ${trunk}`,
  })
  if (!kind) {
    return
  }
  const created = await env.operations.run('Create request', model, async () => {
    await model.repo.setBookmark(name, commit.commitId)
    await model.repo.push(name)
    return client.createRequest({
      head: name,
      base: trunk,
      title: firstLine(commit.description),
      body: bodyAfterTitle(commit.description),
      isDraft: kind === 'Draft',
    })
  })
  if (!created) {
    return
  }
  if (commit.isWorkingCopy) {
    await env.operations.run('New change', model, () => model.repo.newChange([commit.commitId]))
  }
  await env.forge.refreshRequests(model, { force: true })
  const open = await vscode.window.showInformationMessage(
    `Created #${created.number}: ${created.title}`,
    'Open',
  )
  if (open) {
    await vscode.env.openExternal(vscode.Uri.parse(created.url))
  }
}

async function mergeRequest(
  env: CommandEnv,
  model: RepoModel,
  request: RequestBadge,
): Promise<void> {
  const client = await env.forge.client(model, true)
  if (!client) {
    return
  }
  const methods: MergeMethod[] =
    client.kind === 'github' ? ['squash', 'merge', 'rebase'] : ['merge', 'squash']
  const method = await vscode.window.showQuickPick(methods, {
    title: `Ship #${request.number} "${request.title}"`,
  })
  if (!method) {
    return
  }
  await env.operations.run('Ship request', model, async () => {
    await client.mergeRequest(request.number, method as MergeMethod)
    await model.repo.fetch()
  })
  await env.forge.refreshRequests(model, { force: true })
}

async function cleanupRequest(
  env: CommandEnv,
  model: RepoModel,
  request: RequestBadge,
): Promise<void> {
  const bookmark = `bookmarks(exact:${quoteRevsetString(request.headBranch)})`
  const revset = `(::${bookmark} ~ ::trunk()) & mutable()`
  const count = (await model.repo.commitIds(revset)).length
  if (
    !(await confirm(
      `Clean up #${request.number}?`,
      'Clean Up',
      `Abandons ${count} local changes and forgets bookmark "${request.headBranch}".`,
    ))
  ) {
    return
  }
  await env.operations.run('Clean up', model, async () => {
    if (count > 0) {
      await model.repo.abandon(revset)
    }
    await model.repo.forgetBookmark(request.headBranch)
  })
}

async function deleteWorkspace(env: CommandEnv, model: RepoModel, name: string): Promise<void> {
  const workspace = model.graph?.workspaces.find((w) => w.name === name)
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

function workspaceHandler(
  env: CommandEnv,
  fn: (model: RepoModel, name: string) => Promise<unknown>,
): Handler {
  return async (arg?: unknown) => {
    const ctx = parseContext(arg)
    const model = contextModel(env, ctx)
    if (model && ctx.workspace) {
      await fn(model, ctx.workspace)
    }
  }
}

export function refCommands(env: CommandEnv): Record<string, Handler> {
  const op = (label: string, model: RepoModel, task: () => Promise<unknown>) =>
    env.operations.run(label, model, task)

  return {
    'ukemi.bookmark.push': bookmarkHandler(env, (model, name) =>
      op('Push', model, () => model.repo.push(name)),
    ),
    'ukemi.bookmark.delete': bookmarkHandler(env, async (model, name) => {
      if (
        await confirm(
          `Delete bookmark "${name}"?`,
          'Delete',
          'The remote branch is deleted on the next push.',
        )
      ) {
        await op('Delete bookmark', model, () => model.repo.deleteBookmark(name))
      }
    }),
    'ukemi.bookmark.forget': bookmarkHandler(env, (model, name) =>
      op('Forget bookmark', model, () => model.repo.forgetBookmark(name)),
    ),
    'ukemi.bookmark.track': bookmarkHandler(env, (model, name, remote) =>
      op('Track bookmark', model, () => model.repo.trackBookmark(name, remote ?? 'origin')),
    ),
    'ukemi.bookmark.createRequest': async (arg?: unknown) => createRequest(env, arg, false),
    'ukemi.commit.createRequest': async (arg?: unknown) => createRequest(env, arg, false),
    'ukemi.commit.createRequestNamed': async (arg?: unknown) => createRequest(env, arg, true),
    'ukemi.request.open': requestHandler(env, async (_model, request) =>
      vscode.env.openExternal(vscode.Uri.parse(request.url)),
    ),
    'ukemi.request.copyUrl': requestHandler(env, async (_model, request) =>
      vscode.env.clipboard.writeText(request.url),
    ),
    'ukemi.request.pushUpdates': requestHandler(env, (model, request) =>
      op('Push', model, () => model.repo.push(request.headBranch)),
    ),
    'ukemi.request.merge': requestHandler(env, (model, request) =>
      mergeRequest(env, model, request),
    ),
    'ukemi.request.cleanup': requestHandler(env, (model, request) =>
      cleanupRequest(env, model, request),
    ),
    'ukemi.workspace.newChange': workspaceHandler(env, async (model, name) => {
      const workspace = model.graph?.workspaces.find((w) => w.name === name)
      if (workspace?.root) {
        const root = workspace.root
        await op('New change', model, () => model.repo.newChangeInWorkspace(root))
      }
    }),
    'ukemi.workspace.copyPath': workspaceHandler(env, async (model, name) => {
      const root = model.graph?.workspaces.find((w) => w.name === name)?.root
      if (root) {
        await vscode.env.clipboard.writeText(root)
      }
    }),
    'ukemi.workspace.open': workspaceHandler(env, async (model, name) => {
      const root = model.graph?.workspaces.find((w) => w.name === name)?.root
      if (root) {
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), {
          forceNewWindow: true,
        })
      }
    }),
    'ukemi.workspace.delete': workspaceHandler(env, (model, name) =>
      deleteWorkspace(env, model, name),
    ),
  }
}
