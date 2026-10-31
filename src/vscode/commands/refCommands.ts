import * as vscode from 'vscode'
import type { Commit } from '../../../shared/model'
import type { RequestBadge } from '../../../shared/protocol'
import {
  parentBookmarkRevset,
  parentBookmarks,
  shouldPushBase,
  stackDetail,
} from '../../forge/requestBase'
import { isAllowedForgeUrl } from '../../forge/hostName'
import type { MergeMethod } from '../../forge/types'
import { quoteRevsetString } from '../../jj/revsets'
import type { RepoModel } from '../../repo/repoModel'
import { isBookmarkTreeElement } from '../../repo/bookmarkItems'
import { bodyAfterTitle, bookmarkSlug, firstLine, validateBookmarkName } from '../../util/text'
import { describeSync, syncStacks } from '../stackSync'
import { errorMessage } from '../../util/logger'
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

interface TargetBranchPick extends vscode.QuickPickItem {
  branch?: string
  isOther?: boolean
}

function openRequestNumber(model: RepoModel, branch: string): number | undefined {
  const requests = model.graph?.commits.flatMap((commit) => commit.requests) ?? []
  return requests.find(
    (request) =>
      request.headBranch === branch && request.state !== 'merged' && request.state !== 'closed',
  )?.number
}

async function askTargetBranch(
  model: RepoModel,
  commit: Commit,
  trunk: string,
  head: string,
): Promise<string | undefined> {
  const ancestors = await model.repo.log(parentBookmarkRevset(commit.commitId))
  const parents = parentBookmarks(ancestors, trunk, head)
  const picks: TargetBranchPick[] = [
    ...parents.map((branch) => ({
      label: branch,
      detail: stackDetail(branch, openRequestNumber(model, branch)),
      branch,
    })),
    { label: trunk, description: 'trunk', branch: trunk },
    { label: 'Other branch…', isOther: true },
  ]
  const pick = await vscode.window.showQuickPick(picks, {
    title: `Target branch for ${shortId(commit)}`,
    placeHolder: 'Branch the request merges into',
  })
  if (!pick) {
    return undefined
  }
  if (!pick.isOther) {
    return pick.branch
  }
  return vscode.window.showInputBox({
    title: 'Target branch',
    placeHolder: 'Branch name',
    validateInput: validateBookmarkName,
  })
}

async function pushBaseIfNeeded(model: RepoModel, base: string, head: string): Promise<void> {
  const [localNames, pushedNames] = await Promise.all([
    model.repo.bookmarkNames(`bookmarks(exact:${quoteRevsetString(base)})`),
    model.repo.pushedBookmarkNames(),
  ])
  if (shouldPushBase(base, head, localNames, pushedNames)) {
    await model.repo.push(base)
  }
}

interface NewRequestChoice {
  name: string
  base: string
  isDraft: boolean
}

async function askNewRequest(
  model: RepoModel,
  commit: Commit,
  askName: boolean,
  bookmarkName: string | undefined,
): Promise<NewRequestChoice | undefined> {
  const trunk = model.graph?.trunkName ?? 'main'
  const existing = bookmarkName ?? reusableBookmark(commit, trunk)
  const name = askName || !existing ? await askBookmarkName(commit) : existing
  if (!name) {
    return undefined
  }
  const base = await askTargetBranch(model, commit, trunk, name)
  if (!base) {
    return undefined
  }
  const kind = await vscode.window.showQuickPick(['Ready for review', 'Draft'], {
    title: `Create request for ${shortId(commit)} into ${base}`,
  })
  if (!kind) {
    return undefined
  }
  return { name, base, isDraft: kind === 'Draft' }
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
  const request = await askNewRequest(model, commit, askName, bookmarkName)
  if (!request) {
    return
  }
  const created = await env.operations.run('Create request', model, async () => {
    await pushBaseIfNeeded(model, request.base, request.name)
    await model.repo.setBookmark(request.name, commit.commitId)
    await model.repo.push(request.name)
    return client.createRequest({
      head: request.name,
      base: request.base,
      title: firstLine(commit.description),
      body: bodyAfterTitle(commit.description),
      isDraft: request.isDraft,
    })
  })
  if (!created) {
    return
  }
  if (commit.isWorkingCopy) {
    await env.operations.run('New change', model, () => model.repo.newChange([commit.commitId]))
  }
  await env.forge.refreshRequests(model, { force: true })
  if (request.base !== (model.graph?.trunkName ?? 'main')) {
    await autoSyncStack(env, model, created.number)
  }
  const open = await vscode.window.showInformationMessage(
    `Created #${created.number}: ${created.title}`,
    'Open',
  )
  if (open) {
    await openForgeUrl(client.host, created.url)
  }
}

async function openForgeUrl(host: string | undefined, url: string): Promise<void> {
  if (host && isAllowedForgeUrl(url, host)) {
    await vscode.env.openExternal(vscode.Uri.parse(url))
  } else {
    void vscode.window.showWarningMessage('Ukemi: refusing to open a link outside the forge host.')
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
  const below = request.stack ? request.stack.position - 1 : 0
  const method = await vscode.window.showQuickPick(methods, {
    title: `Ship #${request.number} "${request.title}"`,
    placeHolder:
      client.kind === 'github' && below > 0
        ? `Also merges the ${below} ${below === 1 ? 'request' : 'requests'} below it in the stack`
        : undefined,
  })
  if (!method) {
    return
  }
  const outcome = await env.operations.run('Ship request', model, async () => {
    const result = await client.mergeRequest(request.number, method as MergeMethod)
    await model.repo.fetch()
    return result
  })
  await env.forge.refreshRequests(model, { force: true })
  if (outcome === 'enqueued') {
    void vscode.window.showInformationMessage(
      `Ukemi: #${request.number} was added to the merge queue.`,
    )
  }
  if (request.stack) {
    await autoSyncStack(env, model, undefined)
  }
}

async function syncStackFor(
  env: CommandEnv,
  model: RepoModel,
  request: RequestBadge,
): Promise<void> {
  const client = await env.forge.client(model, true)
  if (!client) {
    return
  }
  const result = await env.operations.run('Sync stack', model, () =>
    syncStacks(model, client, env.logger, {
      push: true,
      seed: request.number,
      reload: () => env.forge.refreshRequests(model, { force: true }),
      confirmOverwrite: async (branches) =>
        (await vscode.window.showWarningMessage(
          `The remote branches ${branches.join(', ')} have different content than your local ones. Someone may have pushed to them. Overwrite them with your local versions?`,
          { modal: true },
          'Overwrite',
        )) === 'Overwrite',
    }),
  )
  await env.forge.refreshRequests(model, { force: true })
  if (result) {
    void vscode.window.showInformationMessage(`Ukemi: ${describeSync(result)}`)
  }
}

// Keeps a stack in sync after another action. Never prompts and never fails the action.
async function autoSyncStack(
  env: CommandEnv,
  model: RepoModel,
  seed: number | undefined,
): Promise<void> {
  try {
    const client = await env.forge.client(model, false)
    if (!client) {
      return
    }
    const result = await syncStacks(model, client, env.logger, { push: false, seed })
    env.logger.info(describeSync(result))
    if (result.retargeted.length > 0 || result.native.length > 0) {
      await env.forge.refreshRequests(model, { force: true })
    }
  } catch (error: unknown) {
    env.logger.warn(`stack sync failed: ${errorMessage(error)}`)
  }
}

async function rebaseStack(
  env: CommandEnv,
  model: RepoModel,
  request: RequestBadge,
  commitId: string | undefined,
): Promise<void> {
  const head =
    commitId ??
    model.graph?.commits.find((c) => c.localBookmarks.some((b) => b.name === request.headBranch))
      ?.commitId
  if (!head) {
    void vscode.window.showWarningMessage('Ukemi: the request change is not visible locally.')
    return
  }
  const done = await env.operations.run('Rebase stack', model, () =>
    model.repo.rebase(head, 'trunk()', 'branch'),
  )
  if (done === undefined) {
    return
  }
  const sync = await vscode.window.showInformationMessage(
    'Ukemi: stack rebased onto the trunk. Push it and update the requests?',
    'Sync Stack',
  )
  if (sync) {
    await syncStackFor(env, model, request)
  }
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
    'ukemi.bookmark.trackOrigin': bookmarkHandler(env, ({ model, name }) =>
      op('Track origin', model, () => model.repo.trackBookmark(name, 'origin')),
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
    'ukemi.request.open': requestHandler(env, async (model, request) =>
      openForgeUrl(model.graph?.forge?.host, request.url),
    ),
    'ukemi.request.copyUrl': requestHandler(env, async (_model, request) =>
      vscode.env.clipboard.writeText(request.url),
    ),
    'ukemi.request.pushUpdates': requestHandler(env, async (model, request) => {
      await op('Push', model, () => model.repo.push(request.headBranch))
      if (request.stack) {
        await autoSyncStack(env, model, request.number)
      }
    }),
    'ukemi.request.syncStack': requestHandler(env, (model, request) =>
      syncStackFor(env, model, request),
    ),
    'ukemi.request.rebaseStack': async (arg?: unknown) => {
      const ctx = parseContext(arg)
      const model = contextModel(env, ctx)
      const request = model ? requestFor(model, ctx) : undefined
      if (model && request) {
        await rebaseStack(env, model, request, ctx.commitId)
      }
    },
    'ukemi.request.merge': requestHandler(env, (model, request) =>
      mergeRequest(env, model, request),
    ),
    'ukemi.request.cleanup': requestHandler(env, (model, request) =>
      cleanupRequest(env, model, request),
    ),
  }
}
