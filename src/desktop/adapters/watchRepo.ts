import { watch, type FSWatcher } from 'node:fs'
import { join, sep } from 'node:path'
import type { RepoWatchHandlers, WatchRepo } from '../../app/host'
import type { Logger } from '../../util/logger'
import { errorMessage } from '../../util/logger'
import { repositoryStore } from '../../repo/workspaceFolder'

const INTERNAL = ['.jj', '.git']

// Only the .jj and .git folders themselves: .gitignore and .github are the user's files.
export function isInternal(name: string): boolean {
  return INTERNAL.some((folder) => name === folder || name.startsWith(`${folder}${sep}`))
}

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

// Watches the working copy and jj's operation heads, which a second workspace finds through the
// pointer in its .jj/repo. When the system runs out of watches for a
// big tree, the app still refreshes on new operations and when the window gets focus.
export function fsWatchRepo(logger: Logger): WatchRepo {
  return (root: string, handlers: RepoWatchHandlers) => {
    const files = tryWatch(
      root,
      { recursive: true },
      (name) => {
        if (name === null || !isInternal(name)) {
          handlers.onFile()
        }
      },
      logger,
    )
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
