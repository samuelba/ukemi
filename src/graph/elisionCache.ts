type AncestorResolver = (parentId: string) => Promise<string[]>

export class ElisionCache {
  private readonly values = new Map<string, readonly string[]>()

  get(revset: string, parentId: string, now = new Date()): readonly string[] | undefined {
    const hit = this.values.get(cacheKey(revset, parentId, now))
    return hit ? [...hit] : undefined
  }

  remember(revset: string, parentId: string, ancestors: readonly string[], now = new Date()): void {
    this.values.set(cacheKey(revset, parentId, now), [...ancestors])
  }

  clear(): void {
    this.values.clear()
  }
}

export function cachingResolver(
  cache: ElisionCache,
  revset: string,
  resolve: AncestorResolver,
): AncestorResolver {
  return async (parentId) => {
    const hit = cache.get(revset, parentId)
    if (hit) {
      return [...hit]
    }
    const ancestors = await resolve(parentId)
    cache.remember(revset, parentId, ancestors)
    return ancestors
  }
}

function cacheKey(revset: string, parentId: string, now: Date): string {
  return `${now.toISOString().slice(0, 10)}\0${revset}\0${parentId}`
}
