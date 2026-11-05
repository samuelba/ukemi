type AncestorResolver = (parentId: string) => Promise<string[]>

export interface ElisionHit {
  readonly ancestors: readonly string[]
  // False when the entry was resolved at another operation or on another day. Such an entry can
  // still draw a provisional edge, but new bookmarks, commits or a moved trunk may change it.
  readonly fresh: boolean
}

interface Entry {
  readonly stamp: string
  readonly ancestors: readonly string[]
}

// Remembers which displayed commits an elided parent leads to. The answer depends on the
// revset, which can match different commits after any operation (a new bookmark, a rebase) and,
// for relative dates, on the day, so each entry is stamped with both.
export class ElisionCache {
  private readonly values = new Map<string, Entry>()

  lookup(
    revset: string,
    parentId: string,
    operationId: string | null,
    now = new Date(),
  ): ElisionHit | undefined {
    const entry = this.values.get(entryKey(revset, parentId))
    if (!entry) {
      return undefined
    }
    return { ancestors: [...entry.ancestors], fresh: entry.stamp === stampFor(operationId, now) }
  }

  get(
    revset: string,
    parentId: string,
    operationId: string | null,
    now = new Date(),
  ): readonly string[] | undefined {
    const hit = this.lookup(revset, parentId, operationId, now)
    return hit?.fresh ? hit.ancestors : undefined
  }

  remember(
    revset: string,
    parentId: string,
    operationId: string | null,
    ancestors: readonly string[],
    now = new Date(),
  ): void {
    this.values.set(entryKey(revset, parentId), {
      stamp: stampFor(operationId, now),
      ancestors: [...ancestors],
    })
  }

  // Marks the entries resolved at `from` as resolved at `to`, for a caller that knows the
  // operations in between cannot change any answer.
  carryForward(from: string | null, to: string | null, now = new Date()): void {
    const fromStamp = stampFor(from, now)
    const toStamp = stampFor(to, now)
    for (const [key, entry] of this.values) {
      if (entry.stamp === fromStamp) {
        this.values.set(key, { stamp: toStamp, ancestors: entry.ancestors })
      }
    }
  }

  clear(): void {
    this.values.clear()
  }
}

export function cachingResolver(
  cache: ElisionCache,
  revset: string,
  operationId: string | null,
  resolve: AncestorResolver,
): AncestorResolver {
  return async (parentId) => {
    const hit = cache.get(revset, parentId, operationId)
    if (hit) {
      return [...hit]
    }
    const ancestors = await resolve(parentId)
    cache.remember(revset, parentId, operationId, ancestors)
    return ancestors
  }
}

function entryKey(revset: string, parentId: string): string {
  return `${revset}\0${parentId}`
}

function stampFor(operationId: string | null, now: Date): string {
  return `${now.toISOString().slice(0, 10)}\0${operationId ?? ''}`
}
