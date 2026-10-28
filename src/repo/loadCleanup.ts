import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import {
  UNDESCRIBED_LIMIT,
  type CleanupBookmark,
  type CleanupSelection,
  type CleanupSnapshot,
} from '../../shared/cleanup'
import type { JjRepo } from '../jj/repo'
import {
  bookmarkAbandonRevset,
  classifyBookmarks,
  classifyDeletedBookmarks,
  classifyDivergent,
  classifyUndescribed,
  classifyWorkspaces,
  cleanupSteps,
  removableWorkspaceFolder,
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

async function withAbandonCommits(
  repo: JjRepo,
  bookmarks: readonly CleanupBookmark[],
): Promise<CleanupBookmark[]> {
  return Promise.all(
    bookmarks.map(async (bookmark) => {
      if (bookmark.reason === 'merged') {
        return bookmark
      }
      const abandonCommitIds = await repo.commitIds(bookmarkAbandonRevset(bookmark.name))
      return { ...bookmark, abandonCommitIds }
    }),
  )
}

async function undescribedBlockedIds(
  repo: JjRepo,
  commitIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (commitIds.length === 0) {
    return new Set()
  }
  const blocked = await repo.commitIds(`(${commitIds.join('|')}) & parents(immutable())`)
  return new Set(blocked)
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
  const undescribedCommits = undescribed.map(undescribedCommit)
  const listed = classifyUndescribed(undescribedCommits)
  const blockedIds = await undescribedBlockedIds(
    repo,
    listed.filter((commit) => !commit.isImmutable).map((commit) => commit.commitId),
  )
  return {
    bookmarks: await withAbandonCommits(repo, classifyBookmarks(bookmarks, trunkName)),
    deletedBookmarks: classifyDeletedBookmarks(bookmarks),
    workspaces: classifyWorkspaces(
      workspaces.map((workspace) => ({
        name: workspace.name,
        description: workspace.description,
        isEmpty: workspace.isEmpty,
        isCurrent: isCurrentWorkspace(workspace, repo.root),
        isOpen: workspace.root !== null && isWorkspaceOpen(workspace.root, openFolders),
        rootMissing: workspace.root === null || !existsSync(workspace.root),
        root: workspace.root,
      })),
      repo.root,
    ),
    divergent: classifyDivergent(commits.map(divergentCommit)),
    undescribed: classifyUndescribed(undescribedCommits, blockedIds),
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
        await repo.forgetCleanupBookmark(step.name)
        break
      case 'rebase':
        await repo.rebase(step.revset, step.onto, 'source')
        break
      case 'abandon':
        await repo.abandon(step.revset)
        break
      case 'forgetWorkspace':
        await repo.forgetWorkspace(step.name)
        break
      case 'deleteWorkspaceFiles': {
        const target = removableWorkspaceFolder(repo.root, step.root)
        if (target !== null && existsSync(target)) {
          await rm(target, { recursive: true, force: true })
        }
        break
      }
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
