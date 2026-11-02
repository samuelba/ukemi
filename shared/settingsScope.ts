// The settings a repository can override, without the `ukemi.` prefix. package.json marks the
// same keys `"scope": "resource"`, so VS Code offers them in folder settings too.
export const REPOSITORY_KEYS: ReadonlySet<string> = new Set([
  'showGitTags',
  'showLineStats',
  'defaultFilter',
  'historyDepth',
  'autoFetch.enabled',
  'autoFetch.interval',
  'workspaces.snapshotOnRefresh',
  'forge.ciOnlyMine',
  'forge.requestLimit',
  'forge.nativeStacks',
  'forge.statusInterval',
])

export function isRepositoryKey(key: string): boolean {
  return REPOSITORY_KEYS.has(key)
}
