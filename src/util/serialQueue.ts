export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve()
  private pending = 0

  get size(): number {
    return this.pending
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    this.pending += 1
    const result = this.tail.then(task, task)
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result.finally(() => {
      this.pending -= 1
    })
  }
}
