import type { GraphEdgeInput, GraphNodeInput } from '../../shared/graphLayout'
import type { Commit } from '../../shared/model'

export const ROOT_COMMIT_ID = '0'.repeat(40)
export const MAX_ELIDED_LOOKUPS = 64

export interface GraphNodes {
  nodes: GraphNodeInput[]
  // Hidden parents that need a lookup, because the cache had nothing for them.
  missing: string[]
  // Hidden parents past MAX_ELIDED_LOOKUPS, which get no edge.
  dropped: number
}

// `cutOff` holds parents that the revset matches but that fell past the end of a truncated
// graph. They keep a plain edge to their id, so the lane runs off the bottom of the graph
// instead of ending at the commit, and they need no lookup.
export function graphFromAncestors(
  commits: readonly Commit[],
  ancestorsOf: (parentId: string) => readonly string[] | undefined,
  cutOff: ReadonlySet<string> = new Set(),
): GraphNodes {
  const displayed = new Set(commits.map((commit) => commit.commitId))
  const hidden = hiddenParents(commits, cutOff)
  const looked = hidden.slice(0, MAX_ELIDED_LOOKUPS)
  const resolved = new Map<string, readonly string[]>()
  const missing: string[] = []
  for (const parent of looked) {
    const ancestors = ancestorsOf(parent)
    if (ancestors === undefined) {
      missing.push(parent)
      continue
    }
    resolved.set(
      parent,
      ancestors.filter((id) => displayed.has(id)),
    )
  }
  return {
    nodes: nodesFor(commits, { displayed, cutOff, resolved }),
    missing,
    dropped: hidden.length - looked.length,
  }
}

// The parents that are neither shown nor cut off, top of the graph first.
export function hiddenParents(
  commits: readonly Commit[],
  cutOff: ReadonlySet<string> = new Set(),
): string[] {
  const displayed = new Set(commits.map((commit) => commit.commitId))
  return [
    ...new Set(
      commits
        .flatMap((commit) => commit.parents)
        .filter(
          (parent) => !displayed.has(parent) && !cutOff.has(parent) && parent !== ROOT_COMMIT_ID,
        ),
    ),
  ]
}

interface EdgeSources {
  displayed: ReadonlySet<string>
  cutOff: ReadonlySet<string>
  resolved: ReadonlyMap<string, readonly string[]>
}

function nodesFor(commits: readonly Commit[], sources: EdgeSources): GraphNodeInput[] {
  return commits.map((commit) => ({
    id: commit.commitId,
    parents: edgesFor(commit, sources),
  }))
}

function edgesFor(commit: Commit, sources: EdgeSources): GraphEdgeInput[] {
  const edges: GraphEdgeInput[] = []
  const seen = new Set<string>()
  for (const parent of commit.parents) {
    const isDirect = sources.displayed.has(parent) || sources.cutOff.has(parent)
    const targets = isDirect
      ? [{ id: parent, isElided: false }]
      : (sources.resolved.get(parent) ?? []).map((id) => ({ id, isElided: true }))
    for (const target of targets) {
      if (!seen.has(target.id)) {
        seen.add(target.id)
        edges.push(target)
      }
    }
  }
  return edges
}
