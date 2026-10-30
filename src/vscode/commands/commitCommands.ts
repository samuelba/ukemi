import * as vscode from 'vscode'
import type { CommitView } from '../../../shared/protocol'
import type { Placement } from '../../jj/repo'
import type { RepoModel } from '../../repo/repoModel'
import { combineDescriptions, validateBookmarkName } from '../../util/text'
import { openCommitDiff } from '../diff'
import {
  commitTitle,
  confirm,
  contextCommit,
  shortId,
  type CommandEnv,
  type Handler,
  type Target,
} from './context'

function withTarget(env: CommandEnv, fn: (target: Target) => Promise<unknown>): Handler {
  return async (arg?: unknown) => {
    const target = contextCommit(env, arg)
    if (target) {
      await fn(target)
    }
  }
}

function mutable(commit: CommitView): boolean {
  if (commit.isImmutable) {
    void vscode.window.showWarningMessage(`Ukemi: ${shortId(commit)} is immutable.`)
    return false
  }
  return true
}

export async function describeCommit(
  env: CommandEnv,
  model: RepoModel,
  commit: CommitView,
): Promise<void> {
  if (env.graphView.isVisible) {
    env.graphView.post({
      type: 'describe',
      commitId: commit.commitId,
      description: commit.description,
    })
    return
  }
  const message = await vscode.window.showInputBox({
    title: `Describe ${shortId(commit)}`,
    value: commit.description.trimEnd(),
    prompt: 'Change description',
  })
  if (message !== undefined) {
    await env.operations.run('Describe', model, () => model.repo.describe(commit.commitId, message))
  }
}

export async function editOrNew(
  env: CommandEnv,
  model: RepoModel,
  commit: CommitView,
): Promise<void> {
  if (commit.isImmutable) {
    await env.operations.run('New change', model, () => model.repo.newChange([commit.commitId]))
    return
  }
  await env.operations.run('Edit', model, () => model.repo.edit(commit.commitId))
}

async function pickDestination(model: RepoModel, title: string): Promise<string | undefined> {
  const bookmarks = [
    ...new Set((model.graph?.commits ?? []).flatMap((c) => c.localBookmarks.map((b) => b.name))),
  ]
  const items: vscode.QuickPickItem[] = [
    { label: 'trunk()', description: 'Main line' },
    ...bookmarks.map((name) => ({ label: name, description: 'bookmark' })),
  ]
  const pick = vscode.window.createQuickPick()
  pick.title = title
  pick.placeholder = 'Pick a bookmark or type a change id, commit hash or revset'
  pick.items = items
  return new Promise((resolve) => {
    pick.onDidAccept(() => {
      resolve(pick.selectedItems[0]?.label ?? (pick.value.trim() || undefined))
      pick.hide()
    })
    pick.onDidHide(() => {
      resolve(undefined)
      pick.dispose()
    })
    pick.show()
  })
}

async function pickBookmarkName(model: RepoModel, commit: CommitView): Promise<string | undefined> {
  const existing = [
    ...new Set((model.graph?.commits ?? []).flatMap((c) => c.localBookmarks.map((b) => b.name))),
  ]
  const pick = vscode.window.createQuickPick()
  pick.title = `Set bookmark on ${shortId(commit)}`
  pick.placeholder = 'Type a new bookmark name or move an existing one'
  pick.items = existing.map((name) => ({ label: name, description: 'move here' }))
  return new Promise((resolve) => {
    pick.onDidAccept(() => {
      const name = pick.selectedItems[0]?.label ?? pick.value.trim()
      const problem = validateBookmarkName(name)
      if (problem) {
        pick.title = `Set bookmark on ${shortId(commit)}: ${problem}`
        return
      }
      resolve(name)
      pick.hide()
    })
    pick.onDidHide(() => {
      resolve(undefined)
      pick.dispose()
    })
    pick.show()
  })
}

async function splitByFiles(env: CommandEnv, { model, commit }: Target): Promise<void> {
  const files = await model.filesFor(commit.commitId)
  if (files.length < 2) {
    void vscode.window.showInformationMessage(
      'Ukemi: Split by files needs at least two changed files.',
    )
    return
  }
  const picks = await vscode.window.showQuickPick(
    files.map((f) => ({ label: f.path, description: f.status })),
    {
      canPickMany: true,
      title: `Split ${shortId(commit)}`,
      placeHolder: 'Pick the files for the new change below',
    },
  )
  if (!picks || picks.length === 0 || picks.length === files.length) {
    return
  }
  await env.operations.run('Split', model, () =>
    model.repo.splitFiles(
      commit.commitId,
      picks.map((p) => p.label),
      'below',
    ),
  )
}

async function shipNow(env: CommandEnv, { model, commit }: Target): Promise<void> {
  const trunk = model.graph?.trunkName
  if (!trunk) {
    void vscode.window.showWarningMessage('Ukemi: no trunk bookmark found on a remote.')
    return
  }
  const onTrunk = await model.repo.commitIds(`present(trunk()) & ::${commit.commitId}`)
  if (onTrunk.length === 0) {
    void vscode.window.showWarningMessage(
      `Ukemi: rebase ${shortId(commit)} on ${trunk} before shipping.`,
    )
    return
  }
  const blocked = await model.repo.commitIds(
    `(trunk()..${commit.commitId}) & (conflicts() | description(exact:""))`,
  )
  if (blocked.length > 0) {
    void vscode.window.showWarningMessage(
      'Ukemi: changes with conflicts or without description cannot ship.',
    )
    return
  }
  if (
    !(await confirm(
      `Ship ${shortId(commit)} "${commitTitle(commit)}" to ${trunk}?`,
      'Ship Now',
      `This pushes ${trunk} directly to the remote.`,
    ))
  ) {
    return
  }
  await env.operations.run('Ship', model, async () => {
    await model.repo.setBookmark(trunk, commit.commitId)
    await model.repo.push(trunk)
  })
}

function duplicateAt(
  env: CommandEnv,
  withDescendants: boolean,
  placement: Placement,
  title: string,
): Handler {
  return withTarget(env, async ({ model, commit }) => {
    const destination = await pickDestination(model, title)
    if (destination) {
      const revset = withDescendants ? `${commit.commitId}::` : commit.commitId
      await env.operations.run('Duplicate', model, () =>
        model.repo.duplicate(revset, destination, placement),
      )
    }
  })
}

function rebaseAt(env: CommandEnv, placement: Placement, title: string): Handler {
  return withTarget(env, async ({ model, commit }) => {
    const destination = mutable(commit) ? await pickDestination(model, title) : undefined
    if (destination) {
      await env.operations.run('Rebase', model, () =>
        model.repo.rebase(commit.commitId, destination, 'source', placement),
      )
    }
  })
}

export function commitCommands(env: CommandEnv): Record<string, Handler> {
  const run = (label: string, fn: (t: Target) => Promise<unknown>, needsMutable = false): Handler =>
    withTarget(env, async (target) => {
      if (needsMutable && !mutable(target.commit)) {
        return
      }
      await env.operations.run(label, target.model, () => fn(target))
    })

  return {
    'ukemi.commit.new': run('New change', ({ model, commit }) =>
      model.repo.newChange([commit.commitId]),
    ),
    'ukemi.commit.newBefore': run(
      'Insert change',
      ({ model, commit }) => model.repo.newChange([commit.commitId], { insertBefore: true }),
      true,
    ),
    'ukemi.commit.edit': withTarget(env, ({ model, commit }) => editOrNew(env, model, commit)),
    'ukemi.commit.makeEditable': withTarget(env, async ({ model, commit }) => {
      if (
        await confirm(
          `Edit immutable change ${shortId(commit)}?`,
          'Edit Anyway',
          'Rewriting immutable changes can rewrite shared history.',
        )
      ) {
        await env.operations.run('Edit', model, () =>
          model.repo.edit(commit.commitId, { ignoreImmutable: true }),
        )
      }
    }),
    'ukemi.commit.describe': withTarget(env, async ({ model, commit }) => {
      if (mutable(commit)) {
        await describeCommit(env, model, commit)
      }
    }),
    'ukemi.commit.viewDiff': withTarget(env, async ({ model, commit }) =>
      openCommitDiff(model, commit, await model.filesFor(commit.commitId)),
    ),
    'ukemi.commit.squash': withTarget(env, async ({ model, commit }) => {
      const parent =
        commit.parents.length === 1 ? model.findCommit(commit.parents[0] ?? '') : undefined
      if (!mutable(commit) || (parent && !mutable(parent))) {
        return
      }
      const parentDescription = parent?.description ?? ''
      const message = combineDescriptions(parentDescription, commit.description)
      await env.operations.run('Squash', model, () =>
        model.repo.squashIntoParent(commit.commitId, message),
      )
    }),
    'ukemi.commit.split': withTarget(env, async ({ model, commit }) => {
      if (mutable(commit)) {
        await vscode.commands.executeCommand('ukemi.split.open', {
          repoId: model.root,
          commitId: commit.commitId,
        })
      }
    }),
    'ukemi.commit.splitByFiles': withTarget(env, async (target) => {
      if (mutable(target.commit)) {
        await splitByFiles(env, target)
      }
    }),
    'ukemi.commit.abandon': withTarget(env, async ({ model, commit }) => {
      if (
        mutable(commit) &&
        (await confirm(`Abandon ${shortId(commit)} "${commitTitle(commit)}"?`, 'Abandon'))
      ) {
        await env.operations.run('Abandon', model, () => model.repo.abandon(commit.commitId))
      }
    }),
    'ukemi.commit.abandonSubtree': withTarget(env, async ({ model, commit }) => {
      const count = (await model.repo.commitIds(`${commit.commitId}::`)).length
      if (
        mutable(commit) &&
        (await confirm(`Abandon ${shortId(commit)} and ${count - 1} descendants?`, 'Abandon All'))
      ) {
        await env.operations.run('Abandon', model, () => model.repo.abandon(`${commit.commitId}::`))
      }
    }),
    'ukemi.commit.duplicate': run('Duplicate', ({ model, commit }) =>
      model.repo.duplicate(commit.commitId),
    ),
    'ukemi.commit.duplicateSubtree': run('Duplicate', ({ model, commit }) =>
      model.repo.duplicate(`${commit.commitId}::`),
    ),
    'ukemi.commit.duplicateOnto': duplicateAt(env, false, 'onto', 'Duplicate onto'),
    'ukemi.commit.duplicateOntoSubtree': duplicateAt(env, true, 'onto', 'Duplicate onto'),
    'ukemi.commit.duplicateInsertAfter': duplicateAt(env, false, 'after', 'Duplicate insert after'),
    'ukemi.commit.duplicateInsertAfterSubtree': duplicateAt(
      env,
      true,
      'after',
      'Duplicate insert after',
    ),
    'ukemi.commit.duplicateInsertBefore': duplicateAt(
      env,
      false,
      'before',
      'Duplicate insert before',
    ),
    'ukemi.commit.duplicateInsertBeforeSubtree': duplicateAt(
      env,
      true,
      'before',
      'Duplicate insert before',
    ),
    'ukemi.commit.revert': run('Revert', ({ model, commit }) => model.repo.revert(commit.commitId)),
    'ukemi.commit.rebaseTrunk': run(
      'Rebase',
      ({ model, commit }) => model.repo.rebase(commit.commitId, 'trunk()', 'source'),
      true,
    ),
    'ukemi.commit.rebaseStackTrunk': run(
      'Rebase stack',
      ({ model, commit }) => model.repo.rebase(commit.commitId, 'trunk()', 'branch'),
      true,
    ),
    'ukemi.commit.rebaseOnto': rebaseAt(env, 'onto', 'Rebase onto'),
    'ukemi.commit.rebaseInsertAfter': rebaseAt(env, 'after', 'Rebase insert after'),
    'ukemi.commit.rebaseInsertBefore': rebaseAt(env, 'before', 'Rebase insert before'),
    'ukemi.commit.setBookmark': withTarget(env, async ({ model, commit }) => {
      const name = await pickBookmarkName(model, commit)
      if (name) {
        await env.operations.run('Set bookmark', model, async () => {
          await model.repo.setBookmark(name, commit.commitId)
          model.placeBookmark(name, commit.commitId)
        })
      }
    }),
    'ukemi.commit.copyChangeId': withTarget(env, async ({ commit }) => {
      await vscode.env.clipboard.writeText(commit.changeId)
    }),
    'ukemi.commit.copyCommitId': withTarget(env, async ({ commit }) => {
      await vscode.env.clipboard.writeText(commit.commitId)
    }),
    'ukemi.commit.shipNow': withTarget(env, (target) => shipNow(env, target)),
  }
}
