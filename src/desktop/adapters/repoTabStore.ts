import { Emitter, type Disposable } from '../../app/events'
import { readPrefs, type RepoTabPrefs } from '../repoTabs'
import type { KeyValueFile } from './keyValueFile'

const TABS_KEY = 'repoTabs'

// The names, order and pins of the repository tabs, shared by all windows. A change in one
// window fires onDidChange, so the others show it too.
export class RepoTabStore implements Disposable {
  private readonly emitter = new Emitter<void>()
  readonly onDidChange = this.emitter.event

  constructor(private readonly store: KeyValueFile) {}

  read(): RepoTabPrefs {
    return readPrefs(this.store.get<unknown>(TABS_KEY))
  }

  async change(update: (prefs: RepoTabPrefs) => RepoTabPrefs): Promise<void> {
    const before = this.read()
    const after = update(before)
    if (JSON.stringify(after) === JSON.stringify(before)) {
      return
    }
    await this.store.update(TABS_KEY, after)
    this.emitter.fire()
  }

  dispose(): void {
    this.emitter.dispose()
  }
}
