import { errorMessage } from '../util/logger'

export const COPY_UPDATE_COMMAND = 'Copy Update Command'
const RESTART = 'Restart'

export interface UpdateWindow {
  progress<T>(title: string, task: () => Promise<T>): Promise<T>
  notify(text: string, ...actions: string[]): Promise<string | undefined>
}

export interface UpdateHost {
  currentWindow(): UpdateWindow | undefined
  install(version: string): Promise<void>
  copyCommand(): void
  restart(): void
  logFailure(version: string, message: string): void
}

export class UpdateInstaller {
  private isRunning = false

  constructor(private readonly host: UpdateHost) {}

  async run(window: UpdateWindow, version: string): Promise<void> {
    if (this.isRunning) {
      return
    }
    this.isRunning = true
    let failure: string | undefined
    try {
      await window.progress(`Updating Ukemi to ${version}…`, () => this.host.install(version))
    } catch (error: unknown) {
      failure = errorMessage(error)
      this.host.logFailure(version, failure)
    } finally {
      this.isRunning = false
    }
    // The window that started the update may have closed, and a closed one shows nothing.
    const current = this.host.currentWindow()
    if (!current) {
      return
    }
    if (failure === undefined) {
      await this.offerRestart(current, version)
    } else {
      await this.reportFailure(current, failure)
    }
  }

  private async offerRestart(window: UpdateWindow, version: string): Promise<void> {
    if ((await window.notify(`Ukemi ${version} is installed.`, RESTART)) === RESTART) {
      this.host.restart()
    }
  }

  private async reportFailure(window: UpdateWindow, message: string): Promise<void> {
    const text = `Ukemi was not updated: ${message}`
    if ((await window.notify(text, COPY_UPDATE_COMMAND)) === COPY_UPDATE_COMMAND) {
      this.host.copyCommand()
    }
  }
}
