import type { Commit } from '../../shared/model'
import type { CommitView } from '../../shared/protocol'
import type {
  CleanupHostMessage,
  CleanupSnapshot,
  CleanupWebviewMessage,
} from '../../shared/cleanup'
import { cleanupSteps, forgottenWorkspaceRoots } from '../repo/cleanupItems'
import { applyCleanupSteps, loadCleanup } from '../repo/loadCleanup'
import type { RepoModel } from '../repo/repoModel'
import { errorMessage } from '../util/logger'
import type { CommandEnv } from './commands/context'
import type { PanelChannel, PanelHandler } from './panel'

// Loads the clean-up snapshot into the panel and applies the selection. Returns the message handler.
export function cleanupController(
  env: CommandEnv,
  model: RepoModel,
  panel: PanelChannel<CleanupHostMessage>,
): PanelHandler<CleanupWebviewMessage> {
  let snapshot: CleanupSnapshot | null = null
  let applied = false
  return async (message) => {
    switch (message.type) {
      case 'ready':
        await postSnapshot(env, panel, model, (next) => {
          snapshot = next
        })
        return
      case 'cancel':
        panel.close()
        return
      case 'apply': {
        if (applied || !snapshot) {
          return
        }
        applied = true
        const steps = cleanupSteps(snapshot, message.selection)
        const roots = forgottenWorkspaceRoots(snapshot, message.selection, model.root)
        panel.close()
        if (steps.length === 0) {
          return
        }
        const cleaned = await env.operations.run('Clean up', model, async () => {
          await applyCleanupSteps(model.repo, steps)
          return true
        })
        if (cleaned) {
          for (const root of roots) {
            await env.registry.remove(root)
          }
        }
        return
      }
      case 'loadFiles':
        await postFiles(env, panel, model, message.commitId)
        return
      case 'openFile':
        await openCleanupFile(env, model, message.commitId, message.path)
        return
      case 'openDiff':
        await openCleanupDiff(env, model, message.commitId)
        return
    }
  }
}

function commitView(commit: Commit): CommitView {
  return {
    ...commit,
    row: {
      id: commit.commitId,
      column: 0,
      width: 1,
      incoming: [],
      outgoing: [],
      passThrough: [],
    },
    edges: [],
    isTrunk: false,
    isBehindTrunk: false,
    requests: [],
  }
}

async function viewedCommit(model: RepoModel, commitId: string): Promise<CommitView | null> {
  const [commit] = await model.repo.log(commitId, 1)
  return commit ? commitView(commit) : null
}

async function postFiles(
  env: CommandEnv,
  panel: PanelChannel<CleanupHostMessage>,
  model: RepoModel,
  commitId: string,
): Promise<void> {
  try {
    const files = await model.repo.files(commitId)
    await panel.post({ type: 'files', commitId, files })
  } catch (error: unknown) {
    void env.ui.error(`Clean up failed to load files: ${errorMessage(error)}`)
  }
}

async function withViewedCommit(
  env: CommandEnv,
  model: RepoModel,
  commitId: string,
  open: (commit: CommitView) => Promise<void>,
): Promise<void> {
  try {
    const commit = await viewedCommit(model, commitId)
    if (!commit) {
      void env.ui.warn('Clean up could not find that change.')
      return
    }
    await open(commit)
  } catch (error: unknown) {
    void env.ui.error(`Clean up failed to open the diff: ${errorMessage(error)}`)
  }
}

function openCleanupDiff(env: CommandEnv, model: RepoModel, commitId: string): Promise<void> {
  return withViewedCommit(env, model, commitId, async (commit) =>
    env.workbench.openCommitDiff(model, commit, await model.repo.files(commitId)),
  )
}

function openCleanupFile(
  env: CommandEnv,
  model: RepoModel,
  commitId: string,
  path: string,
): Promise<void> {
  return withViewedCommit(env, model, commitId, async (commit) => {
    const file = (await model.repo.files(commitId)).find((item) => item.path === path)
    if (!file) {
      void env.ui.warn('Clean up could not find that file.')
      return
    }
    await env.workbench.openFileDiff(model, commit, file)
  })
}

async function postSnapshot(
  env: CommandEnv,
  panel: PanelChannel<CleanupHostMessage>,
  model: RepoModel,
  save: (snapshot: CleanupSnapshot) => void,
): Promise<void> {
  try {
    const openFolders = env.folders.folders().map((folder) => folder.path)
    const snapshot = await loadCleanup(model.repo, openFolders)
    save(snapshot)
    await panel.post({ type: 'load', snapshot })
  } catch (error: unknown) {
    void env.ui.error(`Clean up failed to load: ${errorMessage(error)}`)
  }
}
