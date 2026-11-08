import type { Commit } from '../../../shared/model'
import { bookmarkRevision, changeRevision } from '../../jj/revsets'
import type { RepoModel } from '../../repo/repoModel'
import { isBookmarkTreeElement } from '../../repo/bookmarkItems'
import { validateBookmarkName } from '../../util/text'
import { editOrNew } from './commitCommands'
import { confirm } from '../ui'
import { contextModel, parseContext, type CommandEnv, type Handler } from './context'

// Bookmarks as jj sees them. The forge requests built on them are in requestCommands.ts.

export interface BookmarkTarget {
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

export function bookmarkHandler(
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

async function newChangeFromBookmark(env: CommandEnv, target: BookmarkTarget): Promise<void> {
  if (!target.commitId) {
    return
  }
  const revision = bookmarkRevision(target.name, target.remote)
  await env.operations.run('New working copy', target.model, () =>
    target.model.repo.newChange([revision]),
  )
}

export async function commitForBookmark(target: BookmarkTarget): Promise<Commit | undefined> {
  const commitId = target.commitId
  if (!commitId) {
    return undefined
  }
  return target.model.findCommit(commitId) ?? (await target.model.repo.log(commitId, 1))[0]
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
    ? () => target.model.repo.newChange([changeRevision(commit)])
    : () => target.model.repo.edit(changeRevision(commit))
  await env.operations.run(label, target.model, task)
}

async function renameBookmark(env: CommandEnv, target: BookmarkTarget): Promise<void> {
  const next = await env.ui.input({
    title: `Rename bookmark "${target.name}"`,
    value: target.name,
    validate: validateBookmarkName,
  })
  if (!next || next === target.name) {
    return
  }
  await env.operations.run('Rename bookmark', target.model, () =>
    target.model.repo.renameBookmark(target.name, next),
  )
}

async function copyBookmarkName(env: CommandEnv, target: BookmarkTarget): Promise<void> {
  const label = target.remote ? `${target.name}@${target.remote}` : target.name
  await env.ui.copy(label)
}

export function bookmarkCommands(env: CommandEnv): Record<string, Handler> {
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
          env.ui,
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
    'ukemi.bookmark.copyName': bookmarkHandler(env, (target) => copyBookmarkName(env, target)),
  }
}
