import * as vscode from 'vscode'
import type { RepoModel } from '../repo/repoModel'
import { DEFAULT_INTERVAL_MS, fetchDelay, parseDuration } from '../util/duration'
import { errorMessage, type Logger } from '../util/logger'
import { readConfig } from './config'
import type { ForgeService } from './forgeService'
import type { Operations } from './operations'
import type { RepoRegistry } from './registry'

const MAX_TIMER_MS = 2_147_483_647
const IDLE_RETRY_MS = 5_000

export class AutoFetcher implements vscode.Disposable {
  private readonly lastFetch = new Map<string, number>()
  private warnedInterval: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private isRunning = false
  private isDisposed = false
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly registry: RepoRegistry,
    private readonly forge: ForgeService,
    private readonly operations: Operations,
    private readonly logger: Logger,
  ) {
    this.disposables.push(
      registry.onDidChange(() => this.schedule()),
      this.operations.onDidChange(() => this.schedule()),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.schedule()
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (this.affectsSettings(event)) {
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
    for (const disposable of this.disposables) {
      disposable.dispose()
    }
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
      readConfig().autoFetchEnabled &&
      vscode.window.state.focused &&
      model.graph?.hasRemotes === true
    )
  }

  private intervalMs(): number {
    const text = readConfig().autoFetchInterval
    const parsed = parseDuration(text)
    if (parsed !== null) {
      this.warnedInterval = null
      return parsed
    }
    if (this.warnedInterval !== text) {
      this.warnedInterval = text
      this.logger.warn(`auto fetch interval "${text.slice(0, 40)}" is not valid, using 10m`)
    }
    return DEFAULT_INTERVAL_MS
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

  private affectsSettings(event: vscode.ConfigurationChangeEvent): boolean {
    return (
      event.affectsConfiguration('ukemi.autoFetch.enabled') ||
      event.affectsConfiguration('ukemi.autoFetch.interval')
    )
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
