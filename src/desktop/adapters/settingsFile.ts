import { mkdirSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'
import { Emitter, type Disposable } from '../../app/events'
import {
  readSettings,
  type Settings,
  type SettingsChange,
  type UkemiConfig,
} from '../../app/settings'
import { readJsonObject, withoutKey, writeJsonObject } from './jsonFile'

const RELOAD_DELAY_MS = 100

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): Set<string> {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return new Set(
    [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])),
  )
}

// Settings in a JSON file with the keys of VS Code's `ukemi.*` settings, like
// `{ "autoFetch.enabled": true }`. Edits to the file apply while the app runs.
export class SettingsFile implements Settings, Disposable {
  private stored: Record<string, unknown>
  private watcher: FSWatcher | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly emitter = new Emitter<SettingsChange>()
  readonly onDidChange = this.emitter.event

  constructor(readonly path: string) {
    this.stored = readJsonObject(path)
    this.watch()
  }

  read(): UkemiConfig {
    return readSettings({
      get: <T>(key: string, fallback: T): T =>
        key in this.stored ? (this.stored[key] as T) : fallback,
    })
  }

  // The values the user set, without defaults.
  values(): Readonly<Record<string, unknown>> {
    return this.stored
  }

  async update(key: string, value: unknown): Promise<void> {
    const rest = withoutKey(this.stored, key)
    this.apply(value === undefined ? rest : { ...rest, [key]: value })
    writeJsonObject(this.path, this.stored, 0o644)
  }

  // Writes the file once, so the user has something to open and edit.
  ensureFile(): void {
    if (Object.keys(readJsonObject(this.path)).length === 0) {
      writeJsonObject(this.path, this.stored, 0o644)
    }
  }

  dispose(): void {
    this.watcher?.close()
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.emitter.dispose()
  }

  private apply(next: Record<string, unknown>): void {
    const keys = changedKeys(this.stored, next)
    this.stored = next
    if (keys.size > 0) {
      this.emitter.fire({
        affects: (key) =>
          [...keys].some((changed) => changed === key || changed.startsWith(`${key}.`)),
      })
    }
  }

  // Editors often replace the file, so the folder is watched rather than the file.
  private watch(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      this.watcher = watch(dirname(this.path), (_event, name) => {
        if (name !== null && name !== basename(this.path)) {
          return
        }
        if (this.timer) {
          clearTimeout(this.timer)
        }
        this.timer = setTimeout(() => this.apply(readJsonObject(this.path)), RELOAD_DELAY_MS)
      })
    } catch {
      this.watcher = null
    }
  }
}
