import type { ChangedFile } from '../../../shared/model'

export interface FilesFailed {
  error: string
}

// What the host answered for a change's file list: the files, or why jj could not list them.
export type FileLoad = ChangedFile[] | FilesFailed

export const fileKey = (repoId: string, commitId: string): string => `${repoId}\n${commitId}`

export function isFailed(load: FileLoad | undefined): load is FilesFailed {
  return load !== undefined && !Array.isArray(load)
}

// The entries whose key is in `keys`. The same map comes back when none is dropped, so a refresh
// that keeps every change does not render the rows again.
export function keepKeys<V>(
  map: ReadonlyMap<string, V>,
  keys: ReadonlySet<string>,
): ReadonlyMap<string, V> {
  const kept = [...map].filter(([key]) => keys.has(key))
  return kept.length === map.size ? map : new Map(kept)
}
