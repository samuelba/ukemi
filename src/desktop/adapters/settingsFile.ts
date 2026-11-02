import { mkdirSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { isRepositoryKey } from '../../../shared/settingsScope'
import { Emitter, type Disposable } from '../../app/events'
import {
  readSettings,
  type SettingScope,
  type Settings,
  type SettingsChange,
  type SettingValues,
  type UkemiConfig,
} from '../../app/settings'
import { readJsonObject, withoutKey, writeJsonObject } from './jsonFile'

const RELOAD_DELAY_MS = 100
// The overrides of each repository, by its root: `{ "repositories": { "/path": { … } } }`.
const REPOSITORIES = 'repositories'

type Values = Record<string, unknown>

function isValues(value: unknown): value is Values {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function changedKeys(before: Values, after: Values): Set<string> {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return new Set(
    [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])),
  )
}

function matches(keys: Iterable<string>, key: string): boolean {
  return [...keys].some((changed) => changed === key || changed.startsWith(`${key}.`))
}

// What one repository overrides. Keys that a repository cannot set are left out.
function overridesOf(stored: Values, root: string): Values {
  const all = stored[REPOSITORIES]
  const own = isValues(all) ? all[resolve(root)] : undefined
  if (!isValues(own)) {
    return {}
  }
  return Object.fromEntries(Object.entries(own).filter(([key]) => isRepositoryKey(key)))
}

function repositoryRoots(stored: Values): string[] {
  const all = stored[REPOSITORIES]
  return isValues(all) ? Object.keys(all) : []
}

// Settings in a JSON file with the keys of VS Code's `ukemi.*` settings, like
// `{ "autoFetch.enabled": true }`. Edits to the file apply while the app runs.
export class SettingsFile implements Settings, Disposable {
  private stored: Values
  private readonly cache = new Map<string, UkemiConfig>()
  private watcher: FSWatcher | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly emitter = new Emitter<SettingsChange>()
  readonly onDidChange = this.emitter.event

  constructor(readonly path: string) {
    this.stored = readJsonObject(path)
    this.watch()
  }

  read(root?: string): UkemiConfig {
    const cacheKey = root === undefined ? '' : resolve(root)
    const cached = this.cache.get(cacheKey)
    if (cached) {
      return cached
    }
    const values = {
      ...withoutKey(this.stored, REPOSITORIES),
      ...(root === undefined ? {} : overridesOf(this.stored, root)),
    }
    const config = readSettings({
      get: <T>(key: string, fallback: T): T => (key in values ? (values[key] as T) : fallback),
    })
    this.cache.set(cacheKey, config)
    return config
  }

  inspect(key: string, root: string): SettingValues {
    return { globalValue: this.stored[key], repoValue: overridesOf(this.stored, root)[key] }
  }

  // The values the user set, without defaults. With a root, that repository's overrides.
  values(root?: string): Readonly<Values> {
    return root === undefined
      ? withoutKey(this.stored, REPOSITORIES)
      : overridesOf(this.stored, root)
  }

  // The overrides of every repository that has some, by root.
  overrides(): ReadonlyMap<string, Values> {
    return new Map(
      repositoryRoots(this.stored)
        .map((root): [string, Values] => [root, overridesOf(this.stored, root)])
        .filter(([, values]) => Object.keys(values).length > 0),
    )
  }

  async update(key: string, value: unknown, scope: SettingScope = 'default'): Promise<void> {
    if (typeof scope === 'object') {
      this.apply(this.withOverride(resolve(scope.root), key, value))
    } else {
      const rest = withoutKey(this.stored, key)
      this.apply(value === undefined ? rest : { ...rest, [key]: value })
    }
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

  // The stored values with one override set, or removed when `value` is undefined. Empty
  // entries go, so the file holds only what the user chose.
  private withOverride(root: string, key: string, value: unknown): Values {
    if (!isRepositoryKey(key)) {
      throw new Error(`The setting ${key} cannot be set per repository.`)
    }
    const stored = this.stored[REPOSITORIES]
    const all = isValues(stored) ? stored : {}
    const current = all[root]
    const own = withoutKey(isValues(current) ? current : {}, key)
    const nextOwn = value === undefined ? own : { ...own, [key]: value }
    const others = withoutKey(all, root)
    const nextAll = Object.keys(nextOwn).length > 0 ? { ...others, [root]: nextOwn } : others
    const rest = withoutKey(this.stored, REPOSITORIES)
    return Object.keys(nextAll).length > 0 ? { ...rest, [REPOSITORIES]: nextAll } : rest
  }

  private apply(next: Values): void {
    const before = this.stored
    const global = changedKeys(withoutKey(before, REPOSITORIES), withoutKey(next, REPOSITORIES))
    const roots = new Set([...repositoryRoots(before), ...repositoryRoots(next)])
    const perRoot = new Map(
      [...roots].map((root) => [
        root,
        changedKeys(overridesOf(before, root), overridesOf(next, root)),
      ]),
    )
    const changedRoots = [...perRoot.values()].filter((keys) => keys.size > 0)
    // Edits to the file may also change keys a repository cannot set. Those change nothing.
    if (global.size === 0 && changedRoots.length === 0) {
      this.stored = next
      return
    }
    this.stored = next
    this.cache.clear()
    this.emitter.fire({
      affects: (key, root) => {
        if (root === undefined) {
          return matches(global, key) || changedRoots.some((keys) => matches(keys, key))
        }
        const own = perRoot.get(resolve(root))
        // A global change reaches a repository only through the keys it does not override.
        const overrides = overridesOf(next, root)
        const reaches = [...global].some(
          (changed) => matches([changed], key) && !(changed in overrides),
        )
        return (own !== undefined && matches(own, key)) || reaches
      },
    })
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
