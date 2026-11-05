import { watch, type FSWatcher } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from '../../util/logger'
import { errorMessage } from '../../util/logger'
import { isInternal, isRulesFile, joinRel, type IgnoreRules } from './ignoreRules'

// Leaves room for other apps: VS Code and IDEs draw on the same per-user inotify budget.
export const MAX_WATCHED_FOLDERS = 50_000

export interface FolderTreeOptions {
  readonly root: string
  readonly rules: IgnoreRules
  readonly onChange: () => void
  readonly logger: Logger
  readonly maxFolders?: number
}

function isOutOfWatches(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'ENOSPC' || code === 'EMFILE'
}

// Watches each folder jj does not ignore on its own, the way Node's recursive watch does on Linux,
// but without one inotify watch per file and without descending into node_modules, target and
// other ignored output. New folders are picked up as they appear.
export class FolderTreeWatcher {
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly maxFolders: number
  private closed = false
  private full = false

  constructor(private readonly options: FolderTreeOptions) {
    this.maxFolders = options.maxFolders ?? MAX_WATCHED_FOLDERS
  }

  start(): Promise<void> {
    return this.walk('')
  }

  get watchedFolders(): readonly string[] {
    return [...this.watchers.keys()]
  }

  dispose(): void {
    this.closed = true
    this.watchers.forEach((watcher) => watcher.close())
    this.watchers.clear()
  }

  private async walk(rel: string): Promise<void> {
    if (!this.watchFolder(rel)) {
      return
    }
    let entries
    try {
      entries = await readdir(join(this.options.root, rel), { withFileTypes: true })
    } catch {
      return // Removed while we walked; its parent reports that.
    }
    for (const entry of entries) {
      const child = joinRel(rel, entry.name)
      if (
        entry.isDirectory() &&
        !isInternal(child) &&
        !(await this.options.rules.isIgnored(child, true))
      ) {
        await this.walk(child)
      }
    }
  }

  // True when the folder is watched, whether just now or before.
  private watchFolder(rel: string): boolean {
    if (this.closed) {
      return false
    }
    if (this.watchers.has(rel)) {
      return true
    }
    if (this.full) {
      return false
    }
    if (this.watchers.size >= this.maxFolders) {
      this.stopGrowing(`more than ${this.maxFolders} folders`)
      return false
    }
    try {
      const watcher = watch(join(this.options.root, rel), (_event, name) => this.onEvent(rel, name))
      watcher.on('error', () => this.unwatchTree(rel))
      this.watchers.set(rel, watcher)
      return true
    } catch (error: unknown) {
      if (isOutOfWatches(error)) {
        this.stopGrowing(errorMessage(error))
      }
      return false
    }
  }

  private stopGrowing(reason: string): void {
    if (!this.full) {
      this.full = true
      this.options.logger.warn(
        `watching only part of ${this.options.root} (${reason}); other changes show up on the next operation or window focus`,
      )
    }
  }

  private onEvent(folder: string, name: string | null): void {
    if (this.closed) {
      return
    }
    if (name === null) {
      this.options.onChange()
      return
    }
    const rel = joinRel(folder, name)
    if (isInternal(rel)) {
      return
    }
    if (isRulesFile(rel)) {
      this.options.rules.invalidate(folder)
      this.options.onChange()
      this.track(this.rescan())
      return
    }
    this.track(this.classify(rel))
  }

  private track(work: Promise<void>): void {
    work.catch((error: unknown) =>
      this.options.logger.warn(`watching ${this.options.root}: ${errorMessage(error)}`),
    )
  }

  private async classify(rel: string): Promise<void> {
    const stats = await lstat(join(this.options.root, rel)).catch(() => null)
    if (stats?.isDirectory()) {
      if (!(await this.options.rules.isIgnored(rel, true))) {
        this.options.onChange()
        await this.walk(rel) // A new folder, or one moved in, with whatever it already holds.
      }
      return
    }
    if (!stats && this.unwatchTree(rel)) {
      this.options.onChange()
      return
    }
    if (!(await this.options.rules.isIgnored(rel, false))) {
      this.options.onChange()
    }
  }

  // Closes the watchers of a folder that is gone, and of everything below it.
  private unwatchTree(rel: string): boolean {
    let removed = false
    for (const [folder, watcher] of this.watchers) {
      if (folder === rel || (rel === '' ? true : folder.startsWith(`${rel}/`))) {
        watcher.close()
        this.watchers.delete(folder)
        removed = true
      }
    }
    return removed
  }

  // After a .gitignore change: drop folders that are now ignored, add ones that no longer are.
  private async rescan(): Promise<void> {
    for (const folder of this.watchedFolders) {
      if (folder !== '' && (await this.options.rules.isIgnored(folder, true))) {
        this.unwatchTree(folder)
      }
    }
    await this.walk('')
  }
}
