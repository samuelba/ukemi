import { existsSync } from 'node:fs'
import {
  UNDESCRIBED_LIMIT,
  type CleanupSelection,
  type CleanupSnapshot,
} from '../../shared/cleanup'
import type { JjRepo } from '../jj/repo'
import {
  classifyBookmarks,
  classifyDeletedBookmarks,
  classifyDivergent,
  classifyUndescribed,
  classifyWorkspaces,
  cleanupSteps,
  type CleanupStep,
  type DivergentCommit,
  type UndescribedCommit,
} from './cleanupItems'
import { isCurrentWorkspace, isWorkspaceOpen } from './workspaceItems'

const DIVERGENT_REVSET = 'divergent() | children(divergent())'
// jj string escapes `\\` to one backslash, so the regex is `^\s*$`.
const UNDESCRIBED_REVSET = 'description(regex:"^\\\\s*$") ~ @ ~ root()'

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

function undescribedCommit(commit: {
  changePrefix: string
  commitId: string
  commitPrefix: string
  description: string
  committer: { timestamp: string }
  isWorkingCopy: boolean
  isEmpty: boolean
  isImmutable: boolean
}): UndescribedCommit {
  return {
    changePrefix: commit.changePrefix,
    commitId: commit.commitId,
    commitPrefix: commit.commitPrefix,
    description: commit.description,
    timestamp: commit.committer.timestamp,
    isWorkingCopy: commit.isWorkingCopy,
    isEmpty: commit.isEmpty,
    isImmutable: commit.isImmutable,
  }
}

export async function loadCleanup(
  repo: JjRepo,
  openFolders: readonly string[],
): Promise<CleanupSnapshot> {
  const [bookmarks, workspaces, commits, undescribed, trunkName] = await Promise.all([
    repo.bookmarkList(),
    repo.workspaces(),
    repo.log(DIVERGENT_REVSET),
    repo.log(UNDESCRIBED_REVSET, UNDESCRIBED_LIMIT),
    repo.trunkBookmark(),
  ])
  return {
    bookmarks: classifyBookmarks(bookmarks, trunkName),
    deletedBookmarks: classifyDeletedBookmarks(bookmarks),
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
    undescribed: classifyUndescribed(undescribed.map(undescribedCommit)),
    undescribedTruncated: undescribed.length === UNDESCRIBED_LIMIT,
  }
}

export async function applyCleanupSteps(
  repo: JjRepo,
  steps: readonly CleanupStep[],
): Promise<void> {
  for (const step of steps) {
    switch (step.kind) {
      case 'pushDeletedBookmark':
        await repo.push(step.name)
        break
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
