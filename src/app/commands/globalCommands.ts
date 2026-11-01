import { basename } from 'node:path'
import type { ChangedFilesView } from '../../../shared/protocol'
import { InitIncompleteError, JjRepo, readInitFolder, type NewRepoOptions } from '../../jj/repo'
import type { RepoModel } from '../../repo/repoModel'
import {
  bookmarkGoToItems,
  bookmarkRefsFromList,
  resolveBookmarkGoTo,
} from '../../repo/goToTargets'
import { collectBookmarks, type BookmarkRef } from '../../repo/workspaceItems'
import { errorMessage } from '../../util/logger'
import { validateBookmarkName, validateRemoteName, validateRemoteUrl } from '../../util/text'
import { showForgeMissing } from '../forgeMissing'
import { updateWhereItLives, type UkemiConfig } from '../settings'
import type { PickItem } from '../ui'
import { contextModel, parseContext, type CommandEnv, type Handler } from './context'

function activeOrWarn(env: CommandEnv): RepoModel | null {
  const model = env.registry.activeModel
  if (!model) {
    void env.ui.warn('Ukemi: no jj repository is active.')
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
  const pick = await env.ui.pick(
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
  const folder = root ?? (await env.ui.pickFolder('Initialize jj'))
  if (!folder) {
    return
  }
  const state = await readInitFolder(folder)
  if (state === 'jj') {
    void env.ui.error(`Ukemi: ${basename(folder)} is already a jj repository.`)
    return
  }
  if (state === 'git') {
    await initColocatedRepo(env, folder)
    return
  }
  const options = await askNewRepoOptions(env)
  if (!options) {
    return
  }
  await createNewRepo(env, folder, options)
}

async function initColocatedRepo(env: CommandEnv, folder: string): Promise<void> {
  const proceed = await env.ui.ask(
    'info',
    `Initialize a colocated jj repository in ${basename(folder)}?`,
    { detail: 'The Git repository stays usable with Git tools.' },
    'Initialize',
  )
  if (proceed !== 'Initialize') {
    return
  }
  try {
    await env.operations.indicate('Initializing', async () => {
      await JjRepo.initColocated(env.runner, folder)
      await env.registry.addRepo(folder)
    })
  } catch (error: unknown) {
    void env.ui.error(`Ukemi: jj init failed: ${errorMessage(error)}`)
  }
}

async function askNewRepoOptions(env: CommandEnv): Promise<NewRepoOptions | undefined> {
  const remoteUrl = await env.ui.input({
    title: 'Remote URL',
    prompt: 'Git remote for this repository. Leave empty to skip.',
    placeholder: 'git@github.com:org/repo.git',
    validate: validateRemoteUrl,
  })
  if (remoteUrl === undefined) {
    return undefined
  }
  const url = remoteUrl.trim()
  const remoteName = url ? await askRemoteName(env) : 'origin'
  if (!remoteName) {
    return undefined
  }
  const branch = await env.ui.input({
    title: 'Main branch name',
    value: 'main',
    validate: validateBookmarkName,
  })
  if (!branch) {
    return undefined
  }
  return { branch: branch.trim(), remoteName, ...(url ? { remoteUrl: url } : {}) }
}

async function askRemoteName(env: CommandEnv): Promise<string | undefined> {
  const name = await env.ui.input({
    title: 'Remote name',
    value: 'origin',
    validate: validateRemoteName,
  })
  return name?.trim()
}

async function createNewRepo(
  env: CommandEnv,
  folder: string,
  options: NewRepoOptions,
): Promise<void> {
  const cloning = Boolean(options.remoteUrl) && (await readInitFolder(folder)) === 'empty'
  const create = async () => {
    const result = await JjRepo.initNew(env.runner, folder, options)
    await env.registry.addRepo(folder)
    return result
  }
  try {
    const outcome = cloning
      ? await env.ui.progress('Cloning repository', () =>
          env.operations.indicate('Cloning', create),
        )
      : await env.operations.indicate('Initializing', create)
    if (outcome.kind === 'created' && outcome.historyNotDownloaded) {
      void env.ui.info(
        `Ukemi: added the remote. Its commits were not downloaded because ${basename(folder)} already has files.`,
      )
    }
  } catch (error: unknown) {
    void env.ui.error(`Ukemi: jj init failed: ${errorMessage(error)}`)
    if (error instanceof InitIncompleteError) {
      await env.registry.addRepo(folder)
    }
  }
}

type GoToItem = PickItem & {
  revision?: string
  bookmarkName?: string
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
  return [...bookmarks, ...requests]
}

async function chooseBookmarkRevision(
  env: CommandEnv,
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
  const picked = await env.ui.pick(
    resolved.choices.map((choice) => ({ label: choice.label, revision: choice.revision })),
    { title: `New change from ${name}` },
  )
  return picked?.revision
}

async function resolveGoToRevision(
  env: CommandEnv,
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
    return chooseBookmarkRevision(env, choice, local, remote)
  }
  if (choice.revision) {
    return choice.revision
  }
  if (!choice.bookmarkName) {
    return undefined
  }
  return chooseBookmarkRevision(env, choice.bookmarkName, local, remote)
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
  const pick = env.ui.pickOrType(goToItems(model, visible.local, visible.remote), {
    title: 'New change from bookmark, request or revision',
    placeholder: 'Type a change id or revset to start a new change there.',
    matchOnDescription: true,
  })
  const listed = goToBookmarks(env, model)
  void listed.then((bookmarks) => {
    pick.update(goToItems(model, bookmarks.local, bookmarks.remote))
  })
  const choice = await pick.choice
  if (!choice) {
    return
  }
  const { local, remote } = typeof choice !== 'string' && choice.revision ? visible : await listed
  const revision = await resolveGoToRevision(env, choice, local, remote)
  if (revision) {
    await env.operations.run('New change', model, () => model.repo.newChange([revision]))
  }
}

// Flips a switch of the active repository: its own override if it has one, else for all.
function toggleSetting(
  env: CommandEnv,
  key: string,
  field: 'autoFetchEnabled' | 'showGitTags',
): Promise<void> {
  const root = env.registry.activeModel?.root ?? null
  const current: UkemiConfig = env.settings.read(root ?? undefined)
  return updateWhereItLives(env.settings, key, !current[field], root)
}

function setChangedFilesView(env: CommandEnv, view: ChangedFilesView): Promise<void> {
  return env.settings.update('changedFilesView', view)
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
    'ukemi.selectRepository': () => selectRepository(env),
    'ukemi.initRepo': (arg?: unknown) => initRepo(env, typeof arg === 'string' ? arg : undefined),
    'ukemi.fetch': withModel(env, async (model) => {
      const result = await env.operations.run('Fetch', model, () => model.repo.fetch())
      if (result) {
        env.autoFetch.recordFetch(model.root)
      }
      await env.forge.refreshRequests(model, { force: true })
    }),
    'ukemi.toggleAutoFetch': () => toggleSetting(env, 'autoFetch.enabled', 'autoFetchEnabled'),
    'ukemi.toggleGitTags': () => toggleSetting(env, 'showGitTags', 'showGitTags'),
    'ukemi.push': withModel(env, (model) =>
      env.operations.run('Push', model, () => model.repo.push()),
    ),
    'ukemi.pushCurrent': withModel(env, async (model) => {
      const names = model.graph?.currentBookmarks ?? []
      if (names.length === 0) {
        void env.ui.info('Ukemi: the current change and its mutable ancestors have no bookmark.')
        return
      }
      await env.operations.run(`Push ${names.join(', ')}`, model, () => model.repo.push(names))
    }),
    'ukemi.undo': withModel(env, (model) =>
      env.operations.run('Undo', model, () => model.repo.undo()),
    ),
    'ukemi.redo': withModel(env, async (model) => {
      await model.settled()
      if (model.graph?.canRedo === false) {
        void env.ui.info('Ukemi: nothing to redo.')
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
        void env.ui.warn('Ukemi: no jj repository is active.')
        return
      }
      env.workbench.openCleanup(model)
    },
    'ukemi.openCommitDiff': withModel(env, async (model) => {
      const commit = model.graph?.commits.find((c) => c.isWorkingCopy)
      if (commit) {
        await env.workbench.openCommitDiff(model, commit, model.graph?.workingCopyFiles ?? [])
      }
    }),
    'ukemi.forge.signIn': withModel(env, async (model) => {
      if (!(await env.forge.target(model))) {
        await showForgeMissing(model, env)
        return
      }
      const client = await env.forge.signIn(model)
      if (!client) {
        void env.ui.warn('Ukemi: sign-in was cancelled.')
        return
      }
      await env.forge.refreshRequests(model, { force: true })
    }),
    'ukemi.forge.signOut': withModel(env, (model) => env.forge.signOut(model)),
    'ukemi.openSettings': () => env.workbench.openSettings(),
    'ukemi.openRepositorySettings': async (arg?: unknown) => {
      const root = parseContext(arg).repoId ?? env.registry.activeModel?.root
      if (root) {
        await env.workbench.openRepositorySettings(root)
      }
    },
    'ukemi.installJj': () => env.workbench.installJj(),
    'ukemi.view.asList': () => setChangedFilesView(env, 'list'),
    'ukemi.view.asTree': () => setChangedFilesView(env, 'tree'),
  }
}
