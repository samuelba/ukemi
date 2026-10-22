import type { GraphEdgeInput, GraphNodeInput } from '../../shared/graphLayout'
import type { Commit } from '../../shared/model'

export const ROOT_COMMIT_ID = '0'.repeat(40)
const MAX_ELIDED_LOOKUPS = 64

export type AncestorResolver = (parentId: string) => Promise<string[]>

export async function buildGraphNodes(
  commits: readonly Commit[],
  resolveAncestors: AncestorResolver,
): Promise<GraphNodeInput[]> {
  const displayed = new Set(commits.map((c) => c.commitId))
  const missing = [
    ...new Set(
      commits.flatMap((c) => c.parents).filter((p) => !displayed.has(p) && p !== ROOT_COMMIT_ID),
    ),
  ].slice(0, MAX_ELIDED_LOOKUPS)

  const resolved = new Map(
    await Promise.all(
      missing.map(async (parent) => {
        const ancestors = await resolveAncestors(parent).catch(() => [])
        return [parent, ancestors.filter((id) => displayed.has(id))] as const
      }),
    ),
  )

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
