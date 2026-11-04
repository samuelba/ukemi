import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Debouncer } from '../../src/app/debouncer'

describe('Debouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('runs once after the calls stop', () => {
    const task = vi.fn()
    const debouncer = new Debouncer(task)

    debouncer.schedule(400, 2_000)
    vi.advanceTimersByTime(300)
    debouncer.schedule(400, 2_000)
    vi.advanceTimersByTime(399)
    expect(task).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(task).toHaveBeenCalledTimes(1)
  })

  test('runs at the max wait while calls keep coming', () => {
    const task = vi.fn()
    const debouncer = new Debouncer(task)

    for (let elapsed = 0; elapsed < 2_000; elapsed += 100) {
      debouncer.schedule(400, 2_000)
      vi.advanceTimersByTime(100)
    }

    expect(task).toHaveBeenCalledTimes(1)
  })

  test('starts a new max wait after it runs', () => {
    const task = vi.fn()
    const debouncer = new Debouncer(task)

    debouncer.schedule(400, 2_000)
    vi.advanceTimersByTime(400)
    debouncer.schedule(400, 2_000)
    vi.advanceTimersByTime(399)

    expect(task).toHaveBeenCalledTimes(1)
  })

  test('dispose cancels a pending run', () => {
    const task = vi.fn()
    const debouncer = new Debouncer(task)

    debouncer.schedule(400, 2_000)
    debouncer.dispose()
    vi.advanceTimersByTime(5_000)

    expect(task).not.toHaveBeenCalled()
  })
})
