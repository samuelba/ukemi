import type { RequestBadge } from '../../shared/protocol'
import { buildStacks, isOpenRequest } from '../../shared/stack'
import { deadBranchesOf, expectedBase, withBases, type BaseChange } from '../forge/stackSync'
import { parentBookmarkRevset, parentBookmarks } from '../forge/requestBase'
import type { ForgeClient, NativeStackResult } from '../forge/types'
import { quoteRevsetString } from '../jj/revsets'
import type { RepoModel } from '../repo/repoModel'
import { leftoverCopies, resolveMovedBookmarks } from '../repo/movedBookmarks'
import { errorMessage, type Logger } from '../util/logger'
import { readConfig } from './config'

export interface StackSyncOptions {
  push: boolean
  // Restricts pushing and native stack updates to the stack containing this request.
  seed?: number
  // Reloads the requests from the forge once the repository is fetched.
  reload?: () => Promise<void>
  // Asks before overwriting remote branches whose content differs from the local ones.
  confirmOverwrite?: (branches: string[]) => Promise<boolean>
}

export interface StackSyncResult {
  retargeted: BaseChange[]
  pushed: string[]
  native: NativeStackResult[]
  skipped: string[]
}

function conflictedNames(model: RepoModel): Set<string> {
  return new Set(
    (model.graph?.commits ?? []).flatMap((commit) =>
      commit.localBookmarks.filter((b) => b.conflict).map((b) => b.name),
    ),
  )
}

function uniqueRequests(model: RepoModel): RequestBadge[] {
  const seen = new Map<number, RequestBadge>()
  for (const commit of model.graph?.commits ?? []) {
    for (const request of commit.requests) {
      seen.set(request.number, request)
    }
  }
  return [...seen.values()]
}

function localHeadCommit(model: RepoModel, branch: string): string | undefined {
  return model.graph?.commits.find((c) => c.localBookmarks.some((b) => b.name === branch))?.commitId
}

async function plannedChanges(
  model: RepoModel,
  requests: readonly RequestBadge[],
): Promise<BaseChange[]> {
  const trunk = model.graph?.trunkName ?? 'main'
  const openHeads = new Set(requests.filter(isOpenRequest).map((r) => r.headBranch))
  const deadBranches = deadBranchesOf(requests)
  const changes: BaseChange[] = []
  for (const request of requests) {
    const commitId =
      isOpenRequest(request) && request.isMine
        ? localHeadCommit(model, request.headBranch)
        : undefined
    if (!commitId) {
      continue
    }
    const [ancestors, ancestorNames] = await Promise.all([
      model.repo.log(parentBookmarkRevset(commitId)),
      model.repo.bookmarkNames(`::${quoteRevsetString(commitId)}- ~ ::trunk()`),
    ])
    const to = expectedBase({
      current: request.baseBranch,
      trunk,
      parentCandidates: parentBookmarks(ancestors, trunk, request.headBranch).filter((name) =>
        openHeads.has(name),
      ),
      ancestorBookmarks: new Set(ancestorNames),
      deadBranches,
    })
    if (to !== request.baseBranch) {
      changes.push({ number: request.number, from: request.baseBranch, to })
    }
  }
  return changes
}

async function abandonReplaced(
  model: RepoModel,
  commitIds: readonly string[],
  logger: Logger,
): Promise<void> {
  if (commitIds.length === 0) {
    return
  }
  try {
    await model.repo.abandon(leftoverCopies(commitIds))
  } catch (error: unknown) {
    logger.warn(`could not clean up the replaced remote copies: ${errorMessage(error)}`)
  }
}

export async function syncStacks(
  model: RepoModel,
  client: ForgeClient,
  logger: Logger,
  options: StackSyncOptions,
): Promise<StackSyncResult> {
  const skipped: string[] = []
  const replaced: string[] = []
  if (options.push) {
    const heads = uniqueRequests(model)
      .filter((r) => isOpenRequest(r) && r.isMine)
      .map((r) => r.headBranch)
    await model.repo.fetch({ branches: [...heads, model.graph?.trunkName ?? 'main'] })
    await model.refresh()
    await options.reload?.()
    const moved = await resolveMovedBookmarks(
      model.repo,
      conflictedNames(model),
      heads,
      options.confirmOverwrite,
    )
    skipped.push(...moved.skipped)
    replaced.push(...moved.replaced)
    if (moved.resolved.length > 0) {
      await model.refresh()
    }
  }

  const requests = uniqueRequests(model)
  const changes = await plannedChanges(model, requests)
  const chains = buildStacks(withBases(requests, changes)).filter(
    (chain) =>
      chain.length >= 2 &&
      chain.every((r) => r.isMine) &&
      (options.seed === undefined || chain.some((r) => r.number === options.seed)),
  )

  const pushed: string[] = []
  if (options.push) {
    const unsynced = new Set(
      (model.graph?.commits ?? []).flatMap((commit) =>
        commit.localBookmarks.filter((b) => !b.synced).map((b) => b.name),
      ),
    )
    pushed.push(
      ...chains
        .flat()
        .map((r) => r.headBranch)
        .filter((name) => unsynced.has(name) && !skipped.includes(name)),
    )
    if (pushed.length > 0) {
      await model.repo.push(pushed)
      await abandonReplaced(model, replaced, logger)
    }
  }

  for (const change of changes) {
    await client.updateRequestBase(change.number, change.to)
  }

  const native: NativeStackResult[] = []
  if (readConfig().nativeStacks && client.syncNativeStack) {
    for (const chain of chains) {
      try {
        const result = await client.syncNativeStack(chain.map((r) => r.number))
        native.push(result)
        if (result === 'diverged') {
          logger.warn(`native stack of #${chain[0]?.number} differs from the local order`)
        }
      } catch (error: unknown) {
        logger.warn(`native stack sync failed: ${errorMessage(error)}`)
      }
    }
  }
  return { retargeted: changes, pushed, native, skipped }
}

export function describeSync(result: StackSyncResult): string {
  const parts: string[] = []
  if (result.pushed.length > 0) {
    parts.push(`pushed ${result.pushed.join(', ')}`)
  }
  if (result.retargeted.length > 0) {
    parts.push(`retargeted ${result.retargeted.map((c) => `#${c.number} to ${c.to}`).join(', ')}`)
  }
  const stacks = result.native.filter((r) => r === 'created' || r === 'extended').length
  if (stacks > 0) {
    parts.push(`updated ${stacks} GitHub ${stacks === 1 ? 'stack' : 'stacks'}`)
  }
  if (result.skipped.length > 0) {
    parts.push(`left ${result.skipped.join(', ')} alone because the remote branch changed`)
  }
  if (result.native.includes('diverged')) {
    parts.push('a GitHub stack differs from the local order and was left alone')
  }
  return parts.length > 0 ? `Stack synced: ${parts.join('; ')}.` : 'Stack is already in sync.'
}
