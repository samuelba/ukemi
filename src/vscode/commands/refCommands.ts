import * as vscode from 'vscode'
import type { Commit } from '../../../shared/model'
import type { RequestBadge } from '../../../shared/protocol'
import { quoteRevsetString } from '../../jj/revsets'
import type { MergeMethod } from '../../forge/types'
import type { RepoModel } from '../../repo/repoModel'
import { isBookmarkTreeElement } from '../../repo/bookmarkItems'
import { bodyAfterTitle, bookmarkSlug, firstLine, validateBookmarkName } from '../../util/text'
import { editOrNew } from './commitCommands'
import { showForgeMissing } from '../forgeMissing'
import {
  confirm,
  contextCommit,
  contextModel,
  parseContext,
  shortId,
  type CommandEnv,
  type Handler,
} from './context'

interface BookmarkTarget {
  model: RepoModel
  name: string
  remote: string | undefined
  commitId: string | null
}

function bookmarkTarget(env: CommandEnv, arg: unknown): BookmarkTarget | null {
  if (isBookmarkTreeElement(arg)) {
    const model = env.registry.modelFor(arg.repoId) ?? env.registry.activeModel
    return model
      ? { model, name: arg.name, remote: arg.remote ?? undefined, commitId: arg.commitId }
      : null
  }
  const ctx = parseContext(arg)
  const model = contextModel(env, ctx)
  if (!model || !ctx.bookmark) {
    return null
  }
  return {
    model,
    name: ctx.bookmark,
    remote: ctx.remote,
    commitId: ctx.commitId ?? null,
  }
}

function bookmarkHandler(
  env: CommandEnv,
  fn: (target: BookmarkTarget) => Promise<unknown>,
): Handler {
  return async (arg?: unknown) => {
    const target = bookmarkTarget(env, arg)
    if (target) {
      await fn(target)
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

function reusableBookmark(commit: Commit, trunk: string | null): string | undefined {
  return commit.localBookmarks.map((b) => b.name).find((name) => name !== trunk)
}

async function askBookmarkName(commit: Commit): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: 'Branch name for the request',
    value: bookmarkSlug(commit.description, commit.changeId),
    validateInput: validateBookmarkName,
  })
}

async function createRequest(
  env: CommandEnv,
  model: RepoModel,
  commit: Commit,
  askName: boolean,
  bookmarkName?: string,
): Promise<void> {
  if (!commit.description.trim()) {
    void vscode.window.showWarningMessage('Ukemi: describe the change before creating a request.')
    return
  }
  if (!(await env.forge.target(model))) {
    await showForgeMissing(model, env)
    return
  }
  const client = await env.forge.client(model, true)
  if (!client) {
    void vscode.window.showWarningMessage('Ukemi: sign-in was cancelled.')
    return
  }
  const trunk = model.graph?.trunkName ?? 'main'
  const existing = bookmarkName ?? reusableBookmark(commit, trunk)
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

async function createRequestFromContext(
  env: CommandEnv,
  arg: unknown,
  askName: boolean,
): Promise<void> {
  const target = contextCommit(env, arg)
  if (target) {
    await createRequest(env, target.model, target.commit, askName)
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

async function newChangeFromBookmark(env: CommandEnv, target: BookmarkTarget): Promise<void> {
  if (!target.commitId) {
    return
  }
  const revision = target.remote ? `${target.name}@${target.remote}` : target.name
  await env.operations.run('New working copy', target.model, () =>
    target.model.repo.newChange([revision]),
  )
}

async function commitForBookmark(target: BookmarkTarget): Promise<Commit | undefined> {
  const commitId = target.commitId
  if (!commitId) {
    return undefined
  }
  return target.model.findCommit(commitId) ?? (await target.model.repo.log(commitId, 1))[0]
}

async function createRequestFromBookmark(env: CommandEnv, target: BookmarkTarget): Promise<void> {
  if (!target.commitId) {
    return
  }
  const commit = await commitForBookmark(target)
  if (!commit) {
    void vscode.window.showWarningMessage(
      'Ukemi: the change is no longer visible. Refresh and try again.',
    )
    return
  }
  await createRequest(env, target.model, commit, false, target.name)
}

async function editBookmark(env: CommandEnv, target: BookmarkTarget): Promise<void> {
  const commit = await commitForBookmark(target)
  if (!commit) {
    return
  }
  const visible = target.model.findCommit(commit.commitId)
  if (visible) {
    await editOrNew(env, target.model, visible)
    return
  }
  const label = commit.isImmutable ? 'New change' : 'Edit'
  const task = commit.isImmutable
    ? () => target.model.repo.newChange([commit.commitId])
    : () => target.model.repo.edit(commit.commitId)
  await env.operations.run(label, target.model, task)
}

async function renameBookmark(env: CommandEnv, target: BookmarkTarget): Promise<void> {
  const next = await vscode.window.showInputBox({
    title: `Rename bookmark "${target.name}"`,
    value: target.name,
    validateInput: validateBookmarkName,
  })
  if (!next || next === target.name) {
    return
  }
  await env.operations.run('Rename bookmark', target.model, () =>
    target.model.repo.renameBookmark(target.name, next),
  )
}

async function copyBookmarkName(target: BookmarkTarget): Promise<void> {
  const label = target.remote ? `${target.name}@${target.remote}` : target.name
  await vscode.env.clipboard.writeText(label)
}

export function refCommands(env: CommandEnv): Record<string, Handler> {
  const op = (label: string, model: RepoModel, task: () => Promise<unknown>) =>
    env.operations.run(label, model, task)

  const pushBookmark = bookmarkHandler(env, ({ model, name }) =>
    op('Push', model, () => model.repo.push(name)),
  )

  return {
    'ukemi.bookmark.push': pushBookmark,
    'ukemi.bookmark.pushDeleted': pushBookmark,
    'ukemi.bookmark.delete': bookmarkHandler(env, async ({ model, name }) => {
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
    'ukemi.bookmark.forget': bookmarkHandler(env, ({ model, name }) =>
      op('Forget bookmark', model, () => model.repo.forgetBookmark(name)),
    ),
    'ukemi.bookmark.track': bookmarkHandler(env, ({ model, name, remote }) =>
      op('Track bookmark', model, () => model.repo.trackBookmark(name, remote ?? 'origin')),
    ),
    'ukemi.bookmark.untrack': bookmarkHandler(env, ({ model, name, remote }) =>
      op('Untrack bookmark', model, () => model.repo.untrackBookmark(name, remote ?? 'origin')),
    ),
    'ukemi.bookmark.rename': bookmarkHandler(env, (target) => renameBookmark(env, target)),
    'ukemi.bookmark.newChange': bookmarkHandler(env, (target) =>
      newChangeFromBookmark(env, target),
    ),
    'ukemi.bookmark.edit': bookmarkHandler(env, (target) => editBookmark(env, target)),
    'ukemi.bookmark.copyName': bookmarkHandler(env, (target) => copyBookmarkName(target)),
    'ukemi.bookmark.createRequest': bookmarkHandler(env, (target) =>
      createRequestFromBookmark(env, target),
    ),
    'ukemi.commit.createRequest': async (arg?: unknown) =>
      createRequestFromContext(env, arg, false),
    'ukemi.commit.createRequestNamed': async (arg?: unknown) =>
      createRequestFromContext(env, arg, true),
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
  }
}
