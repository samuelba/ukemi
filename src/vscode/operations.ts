import * as vscode from 'vscode'
import type { RepoModel } from '../repo/repoModel'
import { errorMessage, type Logger } from '../util/logger'

export class Operations implements vscode.Disposable {
  private busyLabel: string | null = null
  private lastError: string | null = null
  private readonly emitter = new vscode.EventEmitter<void>()
  readonly onDidChange = this.emitter.event

  constructor(private readonly logger: Logger) {}

  get busy(): string | null {
    return this.busyLabel
  }

  get error(): string | null {
    return this.lastError
  }

  dismissError(): void {
    this.lastError = null
    this.emitter.fire()
  }

  run<T>(label: string, model: RepoModel, task: () => Promise<T>): Promise<T | undefined> {
    return this.track(label, async () => {
      try {
        return await task()
      } finally {
        model.markDirty()
        await model.refresh()
      }
    })
  }

  async track<T>(label: string, task: () => Promise<T>): Promise<T | undefined> {
    this.busyLabel = label
    this.lastError = null
    this.emitter.fire()
    try {
      return await task()
    } catch (error: unknown) {
      this.lastError = `${label} failed: ${errorMessage(error)}`
      this.logger.error(this.lastError)
      return undefined
    } finally {
      this.busyLabel = null
      this.emitter.fire()
    }
  }

  async indicate<T>(label: string, task: () => Promise<T>): Promise<T> {
    this.busyLabel = label
    this.lastError = null
    this.emitter.fire()
    try {
      return await task()
    } finally {
      this.busyLabel = null
      this.emitter.fire()
    }
  }

  dispose(): void {
    this.emitter.dispose()
  }
}
