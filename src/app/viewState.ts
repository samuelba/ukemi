import type { ViewState, ViewStatus } from '../../shared/protocol'
import type { AutoFetcher } from './autoFetch'
import type { Operations } from './operations'
import type { RepoRegistry } from './registry'
import type { UkemiConfig } from './settings'

export interface ViewStateInputs {
  isJjAvailable: boolean
  hasFolders: boolean
  registry: RepoRegistry
  operations: Operations
  config: UkemiConfig
  autoFetch?: Pick<AutoFetcher, 'status'>
}

function status({ isJjAvailable, hasFolders, registry }: ViewStateInputs): ViewStatus {
  if (!isJjAvailable) {
    return 'no-jj'
  }
  if (!hasFolders) {
    return 'no-folder'
  }
  const model = registry.activeModel
  if (!model) {
    return 'no-repo'
  }
  if (model.graph) {
    return 'ready'
  }
  return model.error ? 'error' : 'loading'
}

// The whole state the graph renders from. Both hosts post it after every change.
export function buildViewState(inputs: ViewStateInputs): ViewState {
  const { registry, operations, config } = inputs
  const model = registry.activeModel
  const fetched = model ? inputs.autoFetch?.status(model.root) : undefined
  return {
    status: status(inputs),
    repos: registry.summaries(),
    activeRepoId: registry.activeRepoId,
    graph: model?.graph ?? null,
    busy: operations.busy,
    error: operations.error ?? model?.error ?? null,
    settings: {
      changeIdLength: config.changeIdLength,
      showFullPaths: config.showFullPaths,
      showLineStats: config.showLineStats,
      showGitTags: config.showGitTags,
      previewDrops: config.previewDrops,
      changedFilesView: config.changedFilesView,
      ciOnlyMine: config.ciOnlyMine,
      savedRevsets: config.savedRevsets,
    },
    autoFetch: {
      enabled: config.autoFetchEnabled,
      interval: config.autoFetchInterval,
      isRunning: fetched?.isRunning ?? false,
      lastFetch: fetched?.lastFetch ?? null,
    },
  }
}
