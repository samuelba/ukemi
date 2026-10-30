import type { GraphEdgeInput, GraphNodeInput } from '../../shared/graphLayout'
import type { Commit } from '../../shared/model'

export const ROOT_COMMIT_ID = '0'.repeat(40)
const MAX_ELIDED_LOOKUPS = 64

export type AncestorResolver = (parentId: string) => Promise<string[]>

export async function buildGraphNodes(
  commits: readonly Commit[],
  resolveAncestors: AncestorResolver,
): Promise<GraphNodeInput[]> {
  const resolved = new Map<string, readonly string[]>()
  await Promise.all(
    hiddenParents(commits).map(async (parent) => {
      const ancestors = await resolveAncestors(parent).catch(() => [] as string[])
      resolved.set(parent, ancestors)
    }),
  )
  return graphFromAncestors(commits, (parent) => resolved.get(parent) ?? []).nodes
}

export function graphFromAncestors(
  commits: readonly Commit[],
  ancestorsOf: (parentId: string) => readonly string[] | undefined,
): { nodes: GraphNodeInput[]; missing: string[] } {
  const displayed = new Set(commits.map((commit) => commit.commitId))
  const resolved = new Map<string, readonly string[]>()
  const missing: string[] = []
  for (const parent of hiddenParents(commits)) {
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
  return { nodes: nodesFor(commits, displayed, resolved), missing }
}

function hiddenParents(commits: readonly Commit[]): string[] {
  const displayed = new Set(commits.map((commit) => commit.commitId))
  return [
    ...new Set(
      commits
        .flatMap((commit) => commit.parents)
        .filter((parent) => !displayed.has(parent) && parent !== ROOT_COMMIT_ID),
    ),
  ].slice(0, MAX_ELIDED_LOOKUPS)
}

function nodesFor(
  commits: readonly Commit[],
  displayed: ReadonlySet<string>,
  resolved: ReadonlyMap<string, readonly string[]>,
): GraphNodeInput[] {
  return commits.map((commit) => ({
    id: commit.commitId,
    parents: edgesFor(commit, displayed, resolved),
  }))
}

function edgesFor(
  commit: Commit,
  displayed: ReadonlySet<string>,
  resolved: ReadonlyMap<string, readonly string[]>,
): GraphEdgeInput[] {
  const edges: GraphEdgeInput[] = []
  const seen = new Set<string>()
  for (const parent of commit.parents) {
    const targets = displayed.has(parent)
      ? [{ id: parent, isElided: false }]
      : (resolved.get(parent) ?? []).map((id) => ({ id, isElided: true }))
    for (const target of targets) {
      if (!seen.has(target.id)) {
        seen.add(target.id)
        edges.push(target)
      }
    }
  }
  return edges
}
