export interface OrderNode {
  id: string
  // Where the node would like to be, lower is higher up. Parents always end up below children.
  key: number
  parents: readonly string[]
}

const before = (a: OrderNode, b: OrderNode) => a.key < b.key || (a.key === b.key && a.id < b.id)

// Inserts into a list sorted by (key, id), so the order does not depend on the input order.
function insertSorted(list: OrderNode[], node: OrderNode): void {
  let low = 0
  let high = list.length
  while (low < high) {
    const mid = (low + high) >> 1
    const item = list[mid]
    if (item && before(item, node)) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  list.splice(low, 0, node)
}

/**
 * Orders nodes children first, as jj log does, keeping each node as close to its key as the
 * edges allow. Parents that are not among the nodes are ignored.
 */
export function topoOrder(nodes: readonly OrderNode[]): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const parentsOf = (node: OrderNode) =>
    [...new Set(node.parents)].flatMap((id) => byId.get(id) ?? [])
  const children = new Map<string, number>()
  for (const node of nodes) {
    for (const parent of parentsOf(node)) {
      children.set(parent.id, (children.get(parent.id) ?? 0) + 1)
    }
  }
  const ready = nodes
    .filter((node) => !children.has(node.id))
    .sort((a, b) => (before(a, b) ? -1 : 1))
  const order: string[] = []
  for (let next = ready.shift(); next; next = ready.shift()) {
    order.push(next.id)
    for (const parent of parentsOf(next)) {
      const left = (children.get(parent.id) ?? 1) - 1
      children.set(parent.id, left)
      if (left === 0) {
        insertSorted(ready, parent)
      }
    }
  }
  // A cycle cannot come from jj, but must not lose rows either.
  const done = new Set(order)
  const rest = nodes.filter((node) => !done.has(node.id)).sort((a, b) => a.key - b.key)
  return [...order, ...rest.map((node) => node.id)]
}
