import type { Disposable } from './events'

// A trailing debounce with a ceiling: a steady stream of calls (a build writing files) still
// runs the task once `maxWaitMs` after the first call of a burst.
export class Debouncer implements Disposable {
  private timer: NodeJS.Timeout | null = null
  private deadline: number | null = null

  constructor(private readonly task: () => void) {}

  schedule(delayMs: number, maxWaitMs: number): void {
    const now = Date.now()
    this.deadline ??= now + maxWaitMs
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => this.fire(), Math.max(0, Math.min(delayMs, this.deadline - now)))
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = null
    this.deadline = null
  }

  private fire(): void {
    this.timer = null
    this.deadline = null
    this.task()
  }
}
