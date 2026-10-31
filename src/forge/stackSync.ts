import type { RequestBadge } from '../../shared/protocol'
import { isOpenRequest } from '../../shared/stack'

export interface BaseInput {
  current: string
  trunk: string
  // Nearest ancestor bookmarks that have an open request.
  parentCandidates: readonly string[]
  // Every bookmark between the change and the trunk.
  ancestorBookmarks: ReadonlySet<string>
  // Head branches whose requests are merged or closed.
  deadBranches: ReadonlySet<string>
}

/**
 * The base a request should have. A base the user picked on purpose (an unrelated branch) is kept;
 * only the trunk, an ancestor bookmark or a branch whose request is gone is retargeted.
 */
export function expectedBase(input: BaseInput): string {
  const { current, trunk, parentCandidates, ancestorBookmarks, deadBranches } = input
  if (parentCandidates.includes(current)) {
    return current
  }
  const [nearest] = parentCandidates
  const retargetable =
    current === trunk || ancestorBookmarks.has(current) || deadBranches.has(current)
  if (nearest !== undefined && retargetable) {
    return nearest
  }
  return deadBranches.has(current) ? trunk : current
}

export function deadBranchesOf(requests: readonly RequestBadge[]): Set<string> {
  const open = new Set(requests.filter(isOpenRequest).map((r) => r.headBranch))
  return new Set(
    requests.filter((r) => !isOpenRequest(r) && !open.has(r.headBranch)).map((r) => r.headBranch),
  )
}

export interface BaseChange {
  number: number
  from: string
  to: string
}

export function withBases(
  requests: readonly RequestBadge[],
  changes: readonly BaseChange[],
): RequestBadge[] {
  const byNumber = new Map(changes.map((change) => [change.number, change.to]))
  return requests.map((request) => {
    const base = byNumber.get(request.number)
    return base === undefined ? request : { ...request, baseBranch: base }
  })
}
