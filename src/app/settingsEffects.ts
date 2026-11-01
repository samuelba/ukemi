import type { Disposable } from './events'
import type { RepoRegistry } from './registry'
import type { Settings, SettingsChange } from './settings'

// Settings that change which jj runs. The host reloads it, which also rediscovers repositories.
export const JJ_SETTINGS = ['jjPath'] as const

export function affectsJj(change: SettingsChange, keys: readonly string[] = JJ_SETTINGS): boolean {
  return keys.some((key) => change.affects(key))
}

// Applies changed settings to the open repositories right away, without a restart.
export function applyRepositorySettings(
  change: SettingsChange,
  registry: RepoRegistry,
): Promise<void> | void {
  if (change.affects('repoScanDepth') || change.affects('repoScanExclude')) {
    return registry.discover()
  }
  if (change.affects('workspaces.snapshotOnRefresh')) {
    registry.applyWorkspaceSettings()
  }
  if (change.affects('showLineStats')) {
    return registry.applyLineStats()
  }
}

export function watchRepositorySettings(settings: Settings, registry: RepoRegistry): Disposable {
  return settings.onDidChange((change) => {
    if (!affectsJj(change)) {
      void applyRepositorySettings(change, registry)
    }
  })
}
