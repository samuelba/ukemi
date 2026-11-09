import type { Commit } from '../../../shared/model'
import type { CommitView } from '../../../shared/protocol'
import { changeRevision, bookmarkRevision } from '../../jj/revsets'
import type { Placement, RebaseMode } from '../../jj/repo'
import type { RepoModel } from '../../repo/repoModel'
import { combineDescriptions, validateBookmarkName } from '../../util/text'
import { confirm, type PickItem } from '../ui'
import {
  commitTitle,
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

function mutable(env: CommandEnv, commit: Commit): boolean {
  if (commit.isImmutable) {
    void env.ui.warn(`Ukemi: ${shortId(commit)} is immutable.`)
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
      changeId: commit.changeId,
      description: commit.description,
    })
    return
  }
  const message = await env.ui.input({
    title: `Describe ${shortId(commit)}`,
    value: commit.description.trimEnd(),
    prompt: 'Change description',
  })
  if (message !== undefined) {
    await env.operations.run('Describe', model, () =>
      model.repo.describe(changeRevision(commit), message),
    )
  }
}

export async function editOrNew(
  env: CommandEnv,
  model: RepoModel,
  commit: CommitView,
): Promise<void> {
  if (commit.isImmutable) {
    await env.operations.run('New change', model, () =>
      model.repo.newChange([changeRevision(commit)]),
    )
    return
  }
  await env.operations.run('Edit', model, () => model.repo.edit(changeRevision(commit)))
}

interface DestinationCommit {
  localBookmarks: readonly { name: string }[]
  remoteBookmarks: readonly { name: string; remote: string }[]
}

export function destinationItems(commits: readonly DestinationCommit[]): PickItem[] {
  const local = unique(
    commits.flatMap((commit) =>
      commit.localBookmarks.map((bookmark) => bookmarkRevision(bookmark.name)),
    ),
  )
  const remote = unique(
    commits.flatMap((commit) =>
      commit.remoteBookmarks.map((bookmark) => bookmarkRevision(bookmark.name, bookmark.remote)),
    ),
  )
  return [
    { label: 'trunk()', description: 'Main line' },
    ...local.map((name) => ({ label: name, description: 'bookmark' })),
    ...remote.map((name) => ({ label: name, description: 'remote bookmark' })),
  ]
}

function unique(names: readonly string[]): string[] {
  return [...new Set(names)]
}

async function pickDestination(
  env: CommandEnv,
  model: RepoModel,
  title: string,
): Promise<string | undefined> {
  const choice = await env.ui.pickOrType(destinationItems(model.graph?.commits ?? []), {
    title,
    placeholder: 'Pick a bookmark or type a change id, commit hash or revset',
  }).choice
  return typeof choice === 'string' ? choice : choice?.label
}

async function pickBookmarkName(
  env: CommandEnv,
  model: RepoModel,
  commit: CommitView,
): Promise<string | undefined> {
  const existing = [
    ...new Set((model.graph?.commits ?? []).flatMap((c) => c.localBookmarks.map((b) => b.name))),
  ]
  const choice = await env.ui.pickOrType(
    existing.map((name) => ({ label: name, description: 'move here' })),
    {
      title: `Set bookmark on ${shortId(commit)}`,
      placeholder: 'Type a new bookmark name or move an existing one',
      validate: validateBookmarkName,
    },
  ).choice
  return typeof choice === 'string' ? choice : choice?.label
}

async function splitByFiles(env: CommandEnv, { model, commit }: Target): Promise<void> {
  const files = await model.filesFor(commit.commitId)
  if (files.length < 2) {
    void env.ui.info('Ukemi: Split by files needs at least two changed files.')
    return
  }
  const picks = await env.ui.pickMany(
    files.map((f) => ({ label: f.path, description: f.status })),
    {
      title: `Split ${shortId(commit)}`,
      placeholder: 'Pick the files for the new change below',
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
    void env.ui.warn('Ukemi: no trunk bookmark found on a remote.')
    return
  }
  const onTrunk = await model.repo.commitIds(`present(trunk()) & ::${commit.commitId}`)
  if (onTrunk.length === 0) {
    void env.ui.warn(`Ukemi: rebase ${shortId(commit)} on ${trunk} before shipping.`)
    return
  }
  const blocked = await model.repo.commitIds(
    `(trunk()..${commit.commitId}) & (conflicts() | description(exact:""))`,
  )
  if (blocked.length > 0) {
    void env.ui.warn('Ukemi: changes with conflicts or without description cannot ship.')
    return
  }
  if (
    !(await confirm(
      env.ui,
      `Ship ${shortId(commit)} "${commitTitle(commit)}" to ${trunk}?`,
      'Ship Now',
      `This pushes ${trunk} directly to the remote.`,
    ))
  ) {
    return
  }
  await env.operations.run('Ship', model, async () => {
    await model.repo.setBookmark(trunk, changeRevision(commit))
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
    const destination = await pickDestination(env, model, title)
    if (destination) {
      const revset = withDescendants ? `${changeRevision(commit)}::` : changeRevision(commit)
      await env.operations.run('Duplicate', model, () =>
        model.repo.duplicate(revset, destination, placement),
      )
    }
  })
}

function rebaseAt(
  env: CommandEnv,
  placement: Placement,
  title: string,
  mode: Extract<RebaseMode, 'source' | 'branch'> = 'source',
): Handler {
  return withTarget(env, async ({ model, commit }) => {
    const destination = mutable(env, commit) ? await pickDestination(env, model, title) : undefined
    if (destination) {
      await env.operations.run(mode === 'branch' ? 'Rebase stack' : 'Rebase', model, () =>
        model.repo.rebase(changeRevision(commit), destination, mode, placement),
      )
    }
  })
}

// The destination is resolved inside the operation, so a bad revset shows as its error.
function squashInto(env: CommandEnv): Handler {
  return withTarget(env, async ({ model, commit }) => {
    const destination = mutable(env, commit)
      ? await pickDestination(env, model, `Squash ${shortId(commit)} into`)
      : undefined
    if (!destination) {
      return
    }
    await env.operations.run('Squash', model, async () => {
      const targets = await model.repo.log(destination, 2)
      const [target] = targets
      if (!target || targets.length > 1) {
        throw new Error(`"${destination}" must name exactly one change.`)
      }
      if (target.commitId === commit.commitId) {
        throw new Error('a change cannot be squashed into itself.')
      }
      if (target.isImmutable) {
        throw new Error(`${shortId(target)} is immutable.`)
      }
      const message = combineDescriptions(target.description, commit.description)
      await model.repo.squashInto(changeRevision(commit), changeRevision(target), message)
    })
  })
}

// With paths, only the changes to those files are absorbed.
export async function absorbChanges(
  env: CommandEnv,
  model: RepoModel,
  commit: Commit,
  paths: readonly string[] = [],
): Promise<void> {
  if (!mutable(env, commit)) {
    return
  }
  const result = await env.operations.run('Absorb', model, () =>
    model.repo.absorb(changeRevision(commit), paths),
  )
  if (result && /^Nothing changed\./m.test(result.stderr)) {
    void env.ui.info(
      `Ukemi: nothing to absorb from ${shortId(commit)}. No mutable ancestor last changed those lines.`,
    )
  }
}

export function commitCommands(env: CommandEnv): Record<string, Handler> {
  const run = (label: string, fn: (t: Target) => Promise<unknown>, needsMutable = false): Handler =>
    withTarget(env, async (target) => {
      if (needsMutable && !mutable(env, target.commit)) {
        return
      }
      await env.operations.run(label, target.model, () => fn(target))
    })

  return {
    'ukemi.commit.new': run('New change', ({ model, commit }) =>
      model.repo.newChange([changeRevision(commit)]),
    ),
    'ukemi.commit.newBefore': run(
      'Insert change',
      ({ model, commit }) => model.repo.newChange([changeRevision(commit)], { insertBefore: true }),
      true,
    ),
    'ukemi.commit.edit': withTarget(env, ({ model, commit }) => editOrNew(env, model, commit)),
    'ukemi.commit.makeEditable': withTarget(env, async ({ model, commit }) => {
      if (
        await confirm(
          env.ui,
          `Edit immutable change ${shortId(commit)}?`,
          'Edit Anyway',
          'Rewriting immutable changes can rewrite shared history.',
        )
      ) {
        await env.operations.run('Edit', model, () =>
          model.repo.edit(changeRevision(commit), { ignoreImmutable: true }),
        )
      }
    }),
    'ukemi.commit.describe': withTarget(env, async ({ model, commit }) => {
      if (mutable(env, commit)) {
        await describeCommit(env, model, commit)
      }
    }),
    'ukemi.commit.viewDiff': withTarget(env, async ({ model, commit }) =>
      env.workbench.openCommitDiff(model, commit, await model.filesFor(commit.commitId)),
    ),
    'ukemi.commit.squash': withTarget(env, async ({ model, commit }) => {
      const parentId = commit.parents.length === 1 ? commit.parents[0] : undefined
      // The parent can be elided from the graph, so read it from jj then.
      const parent = parentId
        ? (model.findCommit(parentId) ?? (await model.repo.log(parentId, 1))[0])
        : undefined
      if (!mutable(env, commit) || (parent && !mutable(env, parent))) {
        return
      }
      const parentDescription = parent?.description ?? ''
      const message = combineDescriptions(parentDescription, commit.description)
      await env.operations.run('Squash', model, () =>
        model.repo.squashIntoParent(changeRevision(commit), message),
      )
    }),
    'ukemi.commit.squashInto': squashInto(env),
    'ukemi.commit.absorb': withTarget(env, ({ model, commit }) =>
      absorbChanges(env, model, commit),
    ),
    'ukemi.commit.split': withTarget(env, async (target) => {
      if (mutable(env, target.commit)) {
        await env.workbench.openSplit(target)
      }
    }),
    'ukemi.split.open': withTarget(env, (target) => env.workbench.openSplit(target)),
    'ukemi.commit.splitByFiles': withTarget(env, async (target) => {
      if (mutable(env, target.commit)) {
        await splitByFiles(env, target)
      }
    }),
    'ukemi.commit.abandon': withTarget(env, async ({ model, commit }) => {
      if (
        mutable(env, commit) &&
        (await confirm(env.ui, `Abandon ${shortId(commit)} "${commitTitle(commit)}"?`, 'Abandon'))
      ) {
        await env.operations.run('Abandon', model, () => model.repo.abandon(changeRevision(commit)))
      }
    }),
    'ukemi.commit.abandonSubtree': withTarget(env, async ({ model, commit }) => {
      const count = (await model.repo.commitIds(`${changeRevision(commit)}::`)).length
      if (
        mutable(env, commit) &&
        (await confirm(
          env.ui,
          `Abandon ${shortId(commit)} and ${count - 1} descendants?`,
          'Abandon All',
        ))
      ) {
        await env.operations.run('Abandon', model, () =>
          model.repo.abandon(`${changeRevision(commit)}::`),
        )
      }
    }),
    'ukemi.commit.duplicate': run('Duplicate', ({ model, commit }) =>
      model.repo.duplicate(changeRevision(commit)),
    ),
    'ukemi.commit.duplicateSubtree': run('Duplicate', ({ model, commit }) =>
      model.repo.duplicate(`${changeRevision(commit)}::`),
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
    'ukemi.commit.revert': run('Revert', ({ model, commit }) =>
      model.repo.revert(changeRevision(commit)),
    ),
    'ukemi.commit.rebaseTrunk': run(
      'Rebase',
      ({ model, commit }) => model.repo.rebase(changeRevision(commit), 'trunk()', 'source'),
      true,
    ),
    'ukemi.commit.rebaseStackTrunk': run(
      'Rebase stack',
      ({ model, commit }) => model.repo.rebase(changeRevision(commit), 'trunk()', 'branch'),
      true,
    ),
    'ukemi.commit.rebaseStackOnto': rebaseAt(env, 'onto', 'Rebase stack onto', 'branch'),
    'ukemi.commit.rebaseOnto': rebaseAt(env, 'onto', 'Rebase onto'),
    'ukemi.commit.rebaseInsertAfter': rebaseAt(env, 'after', 'Rebase insert after'),
    'ukemi.commit.rebaseInsertBefore': rebaseAt(env, 'before', 'Rebase insert before'),
    'ukemi.commit.setBookmark': withTarget(env, async ({ model, commit }) => {
      const name = await pickBookmarkName(env, model, commit)
      if (name) {
        await env.operations.run('Set bookmark', model, async () => {
          await model.repo.setBookmark(name, changeRevision(commit))
          model.placeBookmark(name, commit.commitId)
        })
      }
    }),
    'ukemi.commit.advanceBookmark': withTarget(env, async ({ model, commit }) => {
      await env.operations.run('Advance bookmark', model, () =>
        model.repo.advanceBookmark(changeRevision(commit)),
      )
    }),
    'ukemi.commit.copyChangeId': withTarget(env, async ({ commit }) => {
      await env.ui.copy(commit.changeId)
    }),
    'ukemi.commit.copyCommitId': withTarget(env, async ({ commit }) => {
      await env.ui.copy(commit.commitId)
    }),
    'ukemi.commit.shipNow': withTarget(env, (target) => shipNow(env, target)),
  }
}
