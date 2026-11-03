import type { ViewState } from '../../../shared/protocol'

// The host sends the whole graph on every refresh, as new objects. Keeping the objects of the
// commits that did not change lets the memoized rows skip rendering them.
export function keepUnchanged<T extends { commitId: string }>(
  previous: readonly T[] | undefined,
  next: readonly T[],
): T[] {
  if (!previous) {
    return [...next]
  }
  const byId = new Map(previous.map((item) => [item.commitId, item]))
  return next.map((item) => keepIfEqual(byId.get(item.commitId), item))
}

export function keepIfEqual<T>(previous: T | undefined, next: T): T {
  return previous !== undefined && JSON.stringify(previous) === JSON.stringify(next)
    ? previous
    : next
}

export function withUnchangedObjects(previous: ViewState | null, next: ViewState): ViewState {
  const settings = keepIfEqual(previous?.settings, next.settings)
  const before = previous?.graph
  if (!before || !next.graph || before.repoId !== next.graph.repoId) {
    return { ...next, settings }
  }
  return {
    ...next,
    settings,
    graph: {
      ...next.graph,
      commits: keepUnchanged(before.commits, next.graph.commits),
      workingCopyFiles: keepIfEqual(before.workingCopyFiles, next.graph.workingCopyFiles),
    },
  }
}
