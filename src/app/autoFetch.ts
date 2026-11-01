import type { RepoModel } from '../repo/repoModel'
import { DEFAULT_INTERVAL_MS, durationSetting, fetchDelay } from '../util/duration'
import { errorMessage, type Logger } from '../util/logger'
import { disposeAll, type Disposable } from './events'
import type { ForgeService } from './forgeService'
import type { Host } from './host'
import type { Operations } from './operations'
import type { RepoRegistry } from './registry'

const MAX_TIMER_MS = 2_147_483_647
const IDLE_RETRY_MS = 5_000

export class AutoFetcher implements Disposable {
  private readonly lastFetch = new Map<string, number>()
  private readonly readInterval: (text: string) => number
  private timer: ReturnType<typeof setTimeout> | null = null
  private isRunning = false
  private isDisposed = false
  private readonly disposables: Disposable[] = []

  constructor(
    private readonly registry: RepoRegistry,
    private readonly forge: ForgeService,
    private readonly operations: Operations,
    private readonly logger: Logger,
    private readonly host: Pick<Host, 'settings' | 'window'>,
  ) {
    this.readInterval = durationSetting(
      'auto fetch interval',
      DEFAULT_INTERVAL_MS,
      '10m',
      (message) => logger.warn(message),
    )
    this.disposables.push(
      registry.onDidChange(() => this.schedule()),
      this.operations.onDidChange(() => this.schedule()),
      host.window.onDidFocus(() => this.schedule()),
      host.settings.onDidChange((change) => {
        if (change.affects('autoFetch.enabled') || change.affects('autoFetch.interval')) {
          this.schedule()
        }
      }),
    )
    this.schedule()
  }

  recordFetch(root: string): void {
    this.lastFetch.set(root, Date.now())
    this.schedule()
  }

  dispose(): void {
    this.isDisposed = true
    this.clearTimer()
    disposeAll(this.disposables)
  }

  private schedule(): void {
    if (this.isDisposed) {
      return
    }
    this.clearTimer()
    const model = this.registry.activeModel
    if (this.isRunning || !model || !this.canFetch(model)) {
      return
    }
    if (this.operations.busy || model.repo.hasPendingMutations) {
      this.timer = setTimeout(() => this.schedule(), IDLE_RETRY_MS)
      return
    }
    const delay = Math.min(
      fetchDelay(this.lastFetch.get(model.root), Date.now(), this.intervalMs()),
      MAX_TIMER_MS,
    )
    if (delay === 0) {
      void this.fetchNow(model)
      return
    }
    this.timer = setTimeout(() => this.schedule(), delay)
  }

  private canFetch(model: RepoModel): boolean {
    return (
      this.host.settings.read().autoFetchEnabled &&
      this.host.window.isFocused &&
      model.graph?.hasRemotes === true
    )
  }

  private intervalMs(): number {
    return this.readInterval(this.host.settings.read().autoFetchInterval)
  }

  private async fetchNow(model: RepoModel): Promise<void> {
    this.isRunning = true
    const root = model.root
    try {
      await model.repo.fetch({ interactive: false })
      await this.refresh(model)
    } catch (error: unknown) {
      this.logger.error(`auto fetch failed: ${errorMessage(error)}`)
    } finally {
      // A failed attempt still counts, so the next try waits out the interval.
      this.lastFetch.set(root, Date.now())
      this.isRunning = false
      this.schedule()
    }
  }

  private async refresh(model: RepoModel): Promise<void> {
    if (this.registry.activeModel !== model) {
      return
    }
    model.markDirty()
    await model.refresh()
    await this.forge.refreshRequests(model, { force: true })
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
