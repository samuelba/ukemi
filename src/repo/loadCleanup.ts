import { existsSync } from 'node:fs'
import type { CleanupSelection, CleanupSnapshot } from '../../shared/cleanup'
import type { JjRepo } from '../jj/repo'
import {
  classifyBookmarks,
  classifyDivergent,
  classifyWorkspaces,
  cleanupSteps,
  type CleanupStep,
  type DivergentCommit,
} from './cleanupItems'
import { isCurrentWorkspace, isWorkspaceOpen } from './workspaceItems'

const DIVERGENT_REVSET = 'divergent() | children(divergent())'

function divergentCommit(commit: {
  changeId: string
  changePrefix: string
  commitId: string
  commitPrefix: string
  parents: string[]
  description: string
  committer: { timestamp: string }
  isWorkingCopy: boolean
  isImmutable: boolean
  isDivergent: boolean
}): DivergentCommit {
  return {
    changeId: commit.changeId,
    changePrefix: commit.changePrefix,
    commitId: commit.commitId,
    commitPrefix: commit.commitPrefix,
    parents: commit.parents,
    description: commit.description,
    timestamp: commit.committer.timestamp,
    isWorkingCopy: commit.isWorkingCopy,
    isImmutable: commit.isImmutable,
    isDivergent: commit.isDivergent,
  }
}

export async function loadCleanup(
  repo: JjRepo,
  openFolders: readonly string[],
): Promise<CleanupSnapshot> {
  const [bookmarks, workspaces, commits, trunkName] = await Promise.all([
    repo.bookmarkList(),
    repo.workspaces(),
    repo.log(DIVERGENT_REVSET),
    repo.trunkBookmark(),
  ])
  return {
    bookmarks: classifyBookmarks(bookmarks, trunkName),
    workspaces: classifyWorkspaces(
      workspaces.map((workspace) => ({
        name: workspace.name,
        description: workspace.description,
        isEmpty: workspace.isEmpty,
        isCurrent: isCurrentWorkspace(workspace, repo.root),
        isOpen: workspace.root !== null && isWorkspaceOpen(workspace.root, openFolders),
        rootMissing: workspace.root === null || !existsSync(workspace.root),
      })),
    ),
    divergent: classifyDivergent(commits.map(divergentCommit)),
  }
}

export async function applyCleanupSteps(
  repo: JjRepo,
  steps: readonly CleanupStep[],
): Promise<void> {
  for (const step of steps) {
    switch (step.kind) {
      case 'forgetBookmark':
        await repo.forgetBookmark(step.name)
        break
      case 'rebase':
        await repo.rebase(step.revset, step.onto, 'source')
        break
      case 'abandon':
        await repo.abandon(step.commitId)
        break
      case 'forgetWorkspace':
        await repo.forgetWorkspace(step.name)
        break
    }
  }
}

export async function applyCleanup(
  repo: JjRepo,
  snapshot: CleanupSnapshot,
  selection: CleanupSelection,
): Promise<void> {
  await applyCleanupSteps(repo, cleanupSteps(snapshot, selection))
}
