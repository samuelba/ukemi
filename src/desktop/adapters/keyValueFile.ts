import type { KeyValueStore } from '../../app/host'
import { errorMessage } from '../../util/logger'
import {
  invalidCopyPath,
  readJson,
  withoutKey,
  writeJsonObject,
  type ProblemListener,
} from './jsonFile'

// The app's memento: small values kept between runs, like the active repository.
export class KeyValueFile implements KeyValueStore {
  private values: Record<string, unknown>
  // Set after a write failed, so a full disk is reported once and not on every window resize.
  private saveFailed = false

  constructor(
    private readonly path: string,
    private readonly onProblem: ProblemListener = () => undefined,
  ) {
    const read = readJson(path)
    this.values = read.values
    if (read.problem !== null) {
      onProblem(`${read.problem}. Saving state keeps it as ${invalidCopyPath(path)}.`)
    }
  }

  get<T>(key: string): T | undefined {
    return this.values[key] as T | undefined
  }

  // Never rejects: callers fire and forget. A value that cannot be saved still holds until the app
  // quits. The write stays synchronous, so one made while quitting lands before the process exits.
  async update(key: string, value: unknown): Promise<void> {
    const rest = withoutKey(this.values, key)
    this.values = value === undefined ? rest : { ...rest, [key]: value }
    try {
      writeJsonObject(this.path, this.values)
      this.saveFailed = false
    } catch (error: unknown) {
      if (!this.saveFailed) {
        this.saveFailed = true
        this.onProblem(
          `saving ${this.path} failed: ${errorMessage(error)}. Changes last until Ukemi quits.`,
        )
      }
    }
  }

  // A view of the store whose keys are kept apart from other scopes, like one window's folder.
  scoped(scope: string): KeyValueStore {
    return {
      get: <T>(key: string) => this.get<T>(`${scope}\n${key}`),
      update: (key, value) => this.update(`${scope}\n${key}`, value),
    }
  }
}
