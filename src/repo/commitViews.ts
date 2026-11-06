import type { GraphEdgeInput, GraphRow } from '../../shared/graphLayout'
import type { Commit } from '../../shared/model'
import type { CommitView, GraphState } from '../../shared/protocol'
import type { ParsedBookmark } from '../jj/parse'
import type { ChangeRef } from '../jj/revsets'

// Turns the commits jj lists into the rows the graph shows.

export function toCommitView(
  commit: Commit,
  row: GraphRow | undefined,
  trunkId: string | undefined,
  edges: readonly GraphEdgeInput[] = [],
): CommitView {
  return {
    ...commit,
    edges: [...edges],
    row: row ?? {
      id: commit.commitId,
      column: 0,
      width: 1,
      incoming: [],
      outgoing: [],
      passThrough: [],
    },
    isTrunk: commit.commitId === trunkId,
    requests: [],
  }
}

export function remoteBookmarkNames(rows: readonly ParsedBookmark[]): Set<string> {
  return new Set(rows.filter((row) => row.remote !== null).map((row) => row.name))
}

export function markNeverPushed(commits: readonly Commit[], pushed: ReadonlySet<string>): Commit[] {
  return commits.map((commit) =>
    commit.localBookmarks.every((b) => pushed.has(b.name))
      ? commit
      : {
          ...commit,
          localBookmarks: commit.localBookmarks.map((b) =>
            pushed.has(b.name) ? b : { ...b, synced: false },
          ),
        },
  )
}

export function hasUnsyncedBookmarks(commits: readonly Commit[]): boolean {
  return commits.some((c) => c.localBookmarks.some((b) => !b.synced))
}

export function changesOf(state: GraphState | null): Map<string, ChangeRef> {
  const changes = new Map<string, ChangeRef>()
  for (const commit of state?.commits ?? []) {
    changes.set(commit.commitId, {
      commitId: commit.commitId,
      changeId: commit.changeId,
      isDivergent: commit.isDivergent,
      isHidden: commit.isHidden,
    })
  }
  return changes
}
