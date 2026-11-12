import { watch, type FSWatcher } from 'node:fs'
import { join, sep } from 'node:path'
import type { RepoWatchHandlers, WatchFolder, WatchRepo } from '../../app/host'
import type { Logger } from '../../util/logger'
import { errorMessage } from '../../util/logger'
import { repositoryStore } from '../../repo/workspaceFolder'
import { IgnoreRules, isInternal, isRulesFile, parentRel } from './ignoreRules'
import { FolderTreeWatcher } from './treeWatcher'

function tryWatch(
  path: string,
  options: { recursive: boolean },
  listener: (name: string | null) => void,
  logger: Logger,
): FSWatcher | null {
  try {
    const watcher = watch(path, options, (_event, name) => listener(name))
    watcher.on('error', (error) => logger.warn(`watching ${path} stopped: ${errorMessage(error)}`))
    return watcher
  } catch (error: unknown) {
    logger.warn(`cannot watch ${path}: ${errorMessage(error)}`)
    return null
  }
}

// Reports a change unless jj ignores the path, so build output does not trigger snapshots.
export function changeFilter(
  rules: IgnoreRules,
  onChange: () => void,
  logger: Logger,
): (name: string | null) => void {
  return (name) => {
    if (name === null) {
      onChange()
      return
    }
    const rel = name.split(sep).join('/')
    if (isInternal(rel)) {
      return
    }
    if (isRulesFile(rel)) {
      rules.invalidate(parentRel(rel))
      onChange()
      return
    }
    rules.isIgnored(rel, false).then(
      (ignored) => {
        if (!ignored) {
          onChange()
        }
      },
      (error: unknown) => {
        logger.warn(`checking ignore rules for ${rel}: ${errorMessage(error)}`)
        onChange()
      },
    )
  }
}

// macOS and Windows watch a tree with one native handle, so only the events need filtering.
// Node's recursive watch on Linux adds an inotify watch for every file and folder, ignored ones
// included, so there the app walks the tree itself and skips what jj ignores.
function watchWorkingCopy(
  root: string,
  onChange: () => void,
  logger: Logger,
  platform: NodeJS.Platform,
): { close(): void } | null {
  const rules = new IgnoreRules(root)
  if (platform !== 'linux') {
    return tryWatch(root, { recursive: true }, changeFilter(rules, onChange, logger), logger)
  }
  const tree = new FolderTreeWatcher({ root, rules, onChange, logger })
  tree
    .start()
    .catch((error: unknown) => logger.warn(`cannot watch ${root}: ${errorMessage(error)}`))
  return { close: () => tree.dispose() }
}

// Watches the working copy and jj's operation heads, which a second workspace finds through the
// pointer in its .jj/repo. When the system runs out of watches for a
// big tree, the app still refreshes on new operations and when the window gets focus.
export function fsWatchRepo(
  logger: Logger,
  platform: NodeJS.Platform = process.platform,
): WatchRepo {
  return (root: string, handlers: RepoWatchHandlers) => {
    const files = watchWorkingCopy(root, () => handlers.onFile(), logger, platform)
    const ops = tryWatch(
      join(repositoryStore(root), 'op_heads', 'heads'),
      { recursive: false },
      () => handlers.onOperation(),
      logger,
    )
    return {
      dispose: () => {
        files?.close()
        ops?.close()
      },
    }
  }
}

// Watches only the folder's own entries: a repository cloned or created right inside it. Deeper
// ones are found when the window gets focus.
export function fsWatchFolder(logger: Logger): WatchFolder {
  return (folder, onChange) => {
    const watcher = tryWatch(folder, { recursive: false }, () => onChange(), logger)
    return { dispose: () => watcher?.close() }
  }
}
