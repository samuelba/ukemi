export interface Disposable {
  dispose(): void
}

export type Event<T> = (listener: (value: T) => void) => Disposable

// The same contract as vscode.EventEmitter, so either host can subscribe to app services.
export class Emitter<T> implements Disposable {
  private readonly listeners = new Set<(value: T) => void>()

  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  fire(value: T): void {
    for (const listener of [...this.listeners]) {
      listener(value)
    }
  }

  dispose(): void {
    this.listeners.clear()
  }
}

export function disposeAll(disposables: readonly Disposable[]): void {
  for (const disposable of disposables) {
    disposable.dispose()
  }
}
