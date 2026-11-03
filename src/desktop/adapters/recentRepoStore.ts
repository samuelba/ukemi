import { Emitter, type Disposable } from '../../app/events'
import { forget, readRecent, remember } from '../recentRepos'
import type { KeyValueFile } from './keyValueFile'

const RECENT_KEY = 'recentRepositories'

// The repositories used last, newest first, shared by all windows for File > Open Recent.
export class RecentRepoStore implements Disposable {
  private readonly emitter = new Emitter<void>()
  readonly onDidChange = this.emitter.event

  constructor(private readonly store: KeyValueFile) {}

  read(): string[] {
    return readRecent(this.store.get<unknown>(RECENT_KEY))
  }

  remember(root: string): Promise<void> {
    return this.change((recent) => remember(recent, root))
  }

  forget(root: string): Promise<void> {
    return this.change((recent) => forget(recent, root))
  }

  clear(): Promise<void> {
    return this.change(() => [])
  }

  dispose(): void {
    this.emitter.dispose()
  }

  private async change(update: (recent: string[]) => string[]): Promise<void> {
    const before = this.read()
    const after = update(before)
    if (after.length === before.length && after.every((root, index) => root === before[index])) {
      return
    }
    await this.store.update(RECENT_KEY, after)
    this.emitter.fire()
  }
}
