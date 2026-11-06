import { describe, expect, test, vi } from 'vitest'
import { Operations } from '../../src/app/operations'
import type { RepoModel } from '../../src/repo/repoModel'
import { NULL_LOGGER } from '../../src/util/logger'

function fakeModel() {
  let finishRefresh = () => {}
  const model = {
    markDirty: vi.fn(),
    refresh: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve
        }),
    ),
  }
  return { model: model as unknown as RepoModel, mock: model, finishRefresh: () => finishRefresh() }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('Operations.run', () => {
  test('stays busy until the graph reload finishes', async () => {
    const operations = new Operations(NULL_LOGGER)
    const changed = vi.fn()
    operations.onDidChange(changed)
    const { model, mock, finishRefresh } = fakeModel()

    const done = operations.run('Rebase', model, async () => 'rebased')
    await flush()

    expect(mock.markDirty).toHaveBeenCalled()
    expect(mock.refresh).toHaveBeenCalledTimes(1)
    expect(operations.busy).toBe('Rebase')
    expect(changed).toHaveBeenCalledTimes(1)

    finishRefresh()
    await expect(done).resolves.toBe('rebased')
    expect(operations.busy).toBeNull()
    expect(changed).toHaveBeenCalledTimes(2)
  })

  test('reloads after a failed task and reports the error once the reload is done', async () => {
    const operations = new Operations(NULL_LOGGER)
    const { model, mock, finishRefresh } = fakeModel()

    const done = operations.run('Push', model, async () => {
      throw new Error('rejected')
    })
    await flush()

    expect(mock.refresh).toHaveBeenCalledTimes(1)
    expect(operations.busy).toBe('Push')
    expect(operations.error).toBeNull()

    finishRefresh()
    await expect(done).resolves.toBeUndefined()
    expect(operations.busy).toBeNull()
    expect(operations.error).toBe('Push failed: rejected')
  })
})
