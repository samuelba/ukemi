import { layoutGraph, type GraphEdgeInput, type GraphRow } from './graphLayout'
import type { DropAction, DropMode } from './protocol'
import { topoOrder } from './topoOrder'

// What a drop does to the graph, worked out from the shown rows the way jj would do it, so the
// user can look before jj runs. It cannot tell whether the result conflicts.

export interface PreviewInput {
  commitId: string
  isImmutable: boolean
  // The row's edges as the graph draws them, elided ones included.
  edges: readonly GraphEdgeInput[]
}

// `moved` is the dropped change, `carried` its descendants that move with it, `new` a copy,
// `old` where a moved change was, and `reparented` a change that only gets new parents.
export type PreviewRole = 'moved' | 'carried' | 'new' | 'old' | 'reparented'

interface DropBase {
  sourceId: string
  action: DropAction
  mode: DropMode
}

export type PreviewDrop =
  | (DropBase & { kind: 'onto'; targetId: string })
  // Between two changes: after the lower one, before the upper one.
  | (DropBase & { kind: 'between'; afterId: string; beforeId: string })

export interface PreviewNode {
  // The commit id, or `old:` or `new:` and the commit id for the rows a drop adds.
  id: string
  commitId: string
  role: PreviewRole | null
  edges: GraphEdgeInput[]
}

export interface PreviewSummary {
  action: DropAction
  mode: DropMode
  sourceId: string
  // The changes that move or get copied, the dropped one included.
  count: number
  // The target, or the lower and the upper change of a drop between two.
  targetIds: string[]
}

export type PreviewError = 'missing' | 'cycle' | 'immutable' | 'unchanged'

export type PreviewResult =
  | {
      ok: true
      nodes: PreviewNode[]
      rows: GraphRow[]
      summary: PreviewSummary
      // The row the dropped change, or its copy, lands on.
      anchorId: string
    }
  | { ok: false; error: PreviewError }

export const OLD_PREFIX = 'old:'
export const NEW_PREFIX = 'new:'

interface Working extends PreviewNode {
  key: number
}

interface Plan {
  drop: PreviewDrop
  commits: readonly PreviewInput[]
  index: ReadonlyMap<string, number>
  // The dropped change, and its descendants when they move too, top of the graph first.
  set: readonly string[]
  // The new parent of the dropped change.
  parentId: string
  // The change that moves on top of the dropped ones, for a drop between two.
  beforeId: string | null
}

export function previewDrop(
  commits: readonly PreviewInput[],
  drop: PreviewDrop,
  options: { ghosts: boolean } = { ghosts: true },
): PreviewResult {
  const plan = planFor(commits, drop)
  if ('error' in plan) {
    return { ok: false, error: plan.error }
  }
  const working = drop.action === 'rebase' ? rebased(plan, options.ghosts) : duplicated(plan)
  const byId = new Map(working.map((node) => [node.id, node]))
  const order = topoOrder(
    working.map((node) => ({ id: node.id, key: node.key, parents: node.edges.map((e) => e.id) })),
  )
  const nodes = order.flatMap((id) => {
    const node = byId.get(id)
    return node ? [{ id, commitId: node.commitId, role: node.role, edges: node.edges }] : []
  })
  return {
    ok: true,
    nodes,
    rows: layoutGraph(nodes.map((node) => ({ id: node.id, parents: node.edges }))),
    summary: {
      action: drop.action,
      mode: drop.mode,
      sourceId: drop.sourceId,
      count: plan.set.length,
      targetIds: plan.beforeId ? [plan.parentId, plan.beforeId] : [plan.parentId],
    },
    anchorId: drop.action === 'rebase' ? drop.sourceId : NEW_PREFIX + drop.sourceId,
  }
}

function planFor(
  commits: readonly PreviewInput[],
  drop: PreviewDrop,
): Plan | { error: PreviewError } {
  const index = new Map(commits.map((commit, i) => [commit.commitId, i]))
  const parentId = drop.kind === 'onto' ? drop.targetId : drop.afterId
  const beforeId = drop.kind === 'between' ? drop.beforeId : null
  const ids = [drop.sourceId, parentId, ...(beforeId ? [beforeId] : [])]
  if (ids.some((id) => !index.has(id))) {
    return { error: 'missing' }
  }
  const set = drop.mode === 'source' ? descendants(commits, drop.sourceId, index) : [drop.sourceId]
  const plan = { drop, commits, index, set, parentId, beforeId }
  // A drop between two changes rewrites the upper one, which jj refuses when it is immutable.
  const upper = commits.find((commit) => commit.commitId === beforeId)
  if (upper?.isImmutable) {
    return { error: 'immutable' }
  }
  if (drop.action === 'duplicate') {
    return plan
  }
  const error = rebaseError(plan)
  return error ? { error } : plan
}

function rebaseError(plan: Plan): PreviewError | null {
  const { drop, commits, set, parentId, beforeId } = plan
  if (parentId === drop.sourceId || beforeId === drop.sourceId) {
    return 'unchanged'
  }
  if (set.includes(parentId) || (beforeId !== null && set.includes(beforeId))) {
    return 'cycle'
  }
  const moving = new Set(set)
  if (commits.some((commit) => moving.has(commit.commitId) && commit.isImmutable)) {
    return 'immutable'
  }
  const source = commits.find((commit) => commit.commitId === drop.sourceId)
  const edges = source?.edges ?? []
  const sitsThere = edges.length === 1 && edges[0]?.id === parentId && !edges[0].isElided
  // Moved on its own, a change still leaves its children behind, so only one without children
  // stays as it is.
  const hasChildren = commits.some((commit) =>
    commit.edges.some((edge) => edge.id === drop.sourceId),
  )
  const keepsChildren = drop.mode === 'source' || !hasChildren
  return drop.kind === 'onto' && sitsThere && keepsChildren ? 'unchanged' : null
}

// The change and every shown change that descends from it, top of the graph first.
function descendants(
  commits: readonly PreviewInput[],
  sourceId: string,
  index: ReadonlyMap<string, number>,
): string[] {
  const children = new Map<string, string[]>()
  for (const commit of commits) {
    for (const edge of commit.edges) {
      children.set(edge.id, [...(children.get(edge.id) ?? []), commit.commitId])
    }
  }
  const found = new Set([sourceId])
  const queue = [sourceId]
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const child of children.get(id) ?? []) {
      if (!found.has(child)) {
        found.add(child)
        queue.push(child)
      }
    }
  }
  return [...found].sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0))
}

function base(commits: readonly PreviewInput[]): Working[] {
  return commits.map((commit, i) => ({
    id: commit.commitId,
    commitId: commit.commitId,
    role: null,
    edges: [...commit.edges],
    key: i,
  }))
}

// Rows that land on the new parent sit just above it, in their old order.
function placedKey(plan: Plan, position: number): number {
  const anchor = plan.index.get(plan.parentId) ?? 0
  return anchor - 0.5 + (0.5 * (position + 1)) / (plan.set.length + 1)
}

function rebased(plan: Plan, ghosts: boolean): Working[] {
  const { drop, set } = plan
  const moving = new Set(set)
  const original = new Map(plan.commits.map((commit) => [commit.commitId, commit.edges]))
  const sourceEdges = original.get(drop.sourceId) ?? []
  let nodes = base(plan.commits)
  if (drop.mode === 'revision') {
    nodes = nodes.map((node) => withoutSource(node, drop.sourceId, sourceEdges))
  }
  nodes = nodes.map((node) => {
    if (!moving.has(node.id)) {
      return node
    }
    const key = placedKey(plan, set.indexOf(node.id))
    return node.id === drop.sourceId
      ? { ...node, role: 'moved', key, edges: [{ id: plan.parentId, isElided: false }] }
      : { ...node, role: 'carried', key }
  })
  nodes = withBeforeOnHeads(nodes, plan, (id) => id)
  if (!ghosts) {
    return nodes
  }
  const old = (id: string) => (moving.has(id) ? OLD_PREFIX + id : id)
  const faded = set.map((id): Working => ({
    id: OLD_PREFIX + id,
    commitId: id,
    role: 'old',
    edges: (original.get(id) ?? []).map((edge) => ({ ...edge, id: old(edge.id) })),
    key: plan.index.get(id) ?? 0,
  }))
  return [...nodes, ...faded]
}

// A change moved on its own leaves its children on its parents.
function withoutSource(
  node: Working,
  sourceId: string,
  sourceEdges: readonly GraphEdgeInput[],
): Working {
  if (node.id === sourceId || !node.edges.some((edge) => edge.id === sourceId)) {
    return node
  }
  const edges = node.edges.flatMap((edge) =>
    edge.id === sourceId
      ? sourceEdges.map((parent) => ({ id: parent.id, isElided: edge.isElided || parent.isElided }))
      : [edge],
  )
  return { ...node, role: 'reparented', edges: unique(edges) }
}

// jj copies a change with only the parents that are copied too. The roots land on the target.
function duplicated(plan: Plan): Working[] {
  const copied = new Set(plan.set)
  const original = new Map(plan.commits.map((commit) => [commit.commitId, commit.edges]))
  const copies = plan.set.map((id, position): Working => {
    const inside = (original.get(id) ?? [])
      .filter((edge) => copied.has(edge.id))
      .map((edge) => ({ ...edge, id: NEW_PREFIX + edge.id }))
    return {
      id: NEW_PREFIX + id,
      commitId: id,
      role: 'new',
      edges: inside.length > 0 ? inside : [{ id: plan.parentId, isElided: false }],
      key: placedKey(plan, position),
    }
  })
  return [...withBeforeOnHeads(base(plan.commits), plan, (id) => NEW_PREFIX + id), ...copies]
}

// The placed changes that no other placed change descends from. Moving or copying keeps the
// edges among them, so the heads are the same before and after.
function headsOf(plan: Plan): string[] {
  const placed = new Set(plan.set)
  const parents = new Set(
    plan.commits
      .filter((commit) => placed.has(commit.commitId))
      .flatMap((commit) => commit.edges.map((edge) => edge.id)),
  )
  return plan.set.filter((id) => !parents.has(id))
}

// For a drop between two changes, the upper one moves onto the heads of the placed changes.
function withBeforeOnHeads(nodes: Working[], plan: Plan, idOf: (id: string) => string): Working[] {
  if (plan.beforeId === null) {
    return nodes
  }
  const heads = headsOf(plan).map(idOf)
  return nodes.map((node) =>
    node.id === plan.beforeId
      ? {
          ...node,
          role: 'reparented',
          edges: unique(
            node.edges.flatMap((edge) =>
              edge.id === plan.parentId ? heads.map((id) => ({ id, isElided: false })) : [edge],
            ),
          ),
        }
      : node,
  )
}

function unique(edges: readonly GraphEdgeInput[]): GraphEdgeInput[] {
  const seen = new Set<string>()
  return edges.filter((edge) => !seen.has(edge.id) && Boolean(seen.add(edge.id)))
}
