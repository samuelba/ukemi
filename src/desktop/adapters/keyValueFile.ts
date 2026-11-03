import type { KeyValueStore } from '../../app/host'
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

  constructor(
    private readonly path: string,
    onProblem: ProblemListener = () => undefined,
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

  async update(key: string, value: unknown): Promise<void> {
    const rest = withoutKey(this.values, key)
    this.values = value === undefined ? rest : { ...rest, [key]: value }
    writeJsonObject(this.path, this.values)
  }

  // A view of the store whose keys are kept apart from other scopes, like one window's folder.
  scoped(scope: string): KeyValueStore {
    return {
      get: <T>(key: string) => this.get<T>(`${scope}\n${key}`),
      update: (key, value) => this.update(`${scope}\n${key}`, value),
    }
  }
}
