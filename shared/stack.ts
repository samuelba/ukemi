import type { RequestBadge } from './protocol'

export function isOpenRequest(request: Pick<RequestBadge, 'state'>): boolean {
  return request.state !== 'merged' && request.state !== 'closed'
}

/**
 * Chains open requests bottom-first: a request continues its parent's chain when its base is the
 * parent's head branch and it is the parent's only child. A request whose parent has several
 * children starts its own chain, so every chain is linear.
 */
export function buildStacks(requests: readonly RequestBadge[]): RequestBadge[][] {
  const open = requests.filter(isOpenRequest)
  const byHead = new Map<string, RequestBadge>()
  for (const request of open) {
    if (!byHead.has(request.headBranch)) {
      byHead.set(request.headBranch, request)
    }
  }
  const children = new Map<number, RequestBadge[]>()
  const roots: RequestBadge[] = []
  for (const request of open) {
    const parent = byHead.get(request.baseBranch)
    if (parent && parent.number !== request.number) {
      children.set(parent.number, [...(children.get(parent.number) ?? []), request])
    } else {
      roots.push(request)
    }
  }
  const chains: RequestBadge[][] = []
  const visited = new Set<number>()
  const walk = (start: RequestBadge): void => {
    const chain: RequestBadge[] = []
    let node: RequestBadge | undefined = start
    while (node && !visited.has(node.number)) {
      visited.add(node.number)
      chain.push(node)
      const next: RequestBadge[] = children.get(node.number) ?? []
      if (next.length !== 1) {
        next.forEach(walk)
        break
      }
      node = next[0]
    }
    chains.push(chain)
  }
  roots.forEach(walk)
  return chains
}

export function withStackInfo(requests: readonly RequestBadge[]): RequestBadge[] {
  const info = new Map<number, { position: number; size: number }>()
  for (const chain of buildStacks(requests)) {
    if (chain.length < 2) {
      continue
    }
    chain.forEach((request, index) => {
      info.set(request.number, { position: index + 1, size: chain.length })
    })
  }
  return requests.map((request) => {
    const rest = { ...request }
    delete rest.stack
    const stack = info.get(request.number)
    return stack ? { ...rest, stack } : rest
  })
}

export function stackOf(requests: readonly RequestBadge[], number: number): RequestBadge[] {
  return buildStacks(requests).find((chain) => chain.some((r) => r.number === number)) ?? []
}

export function stackLabel(stack: RequestBadge['stack']): string | null {
  return stack ? `${stack.position}/${stack.size}` : null
}
