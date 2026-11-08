import { describe, expect, test } from 'vitest'
import type { ChangeDetail } from '../../shared/desktopProtocol'
import type { ChangedFile } from '../../shared/model'
import type { CommitView } from '../../shared/protocol'
import { DetailPresenter, type DetailModel } from '../../src/desktop/detailPresenter'
import { NULL_LOGGER } from '../../src/util/logger'

function commit(commitId: string, changeId: string): CommitView {
  return { commitId, changeId, isWorkingCopy: false, isImmutable: false } as CommitView
}

function setup(commits: CommitView[]) {
  let shown = commits
  const held = new Map<string, Promise<void>>()
  const model: DetailModel = {
    root: '/repo',
    graph: null,
    findCommit: (id: string) => shown.find((c) => c.commitId === id),
    commitFor: (id: string, changeId: string) =>
      shown.find((c) => c.commitId === id) ?? shown.find((c) => c.changeId === changeId) ?? null,
    filesFor: async (id: string): Promise<ChangedFile[]> => {
      await held.get(id)
      return []
    },
    evolutionFor: async () => [],
  } as unknown as DetailModel
  const posted: (ChangeDetail | null)[] = []
  const presenter = new DetailPresenter({
    activeModel: () => model,
    changeIdLength: () => 4,
    post: (detail) => posted.push(detail),
    withActions: (row) => row,
    logger: NULL_LOGGER,
    now: () => 0,
  })
  return {
    presenter,
    posted,
    rewrite: (next: CommitView[]) => (shown = next),
    // Keeps the files of `commitId` loading until the returned function runs.
    holdFiles: (commitId: string) => {
      let release = () => undefined as void
      held.set(commitId, new Promise<void>((resolve) => (release = resolve)))
      return () => release()
    },
  }
}

describe('DetailPresenter', () => {
  test('a new change posts at once and again with its evolution', async () => {
    const { presenter, posted } = setup([commit('c1', 'k1')])
    await presenter.show('c1')
    expect(posted.map((d) => d?.evolution ?? null)).toEqual([null, []])
  })

  test('a refresh that changes nothing posts nothing', async () => {
    const { presenter, posted } = setup([commit('c1', 'k1')])
    await presenter.show('c1')
    await presenter.refresh()
    expect(posted).toHaveLength(2)
  })

  test('follows the change through a rewrite, posting once', async () => {
    const { presenter, posted, rewrite } = setup([commit('c1', 'k1')])
    await presenter.show('c1')
    rewrite([commit('c2', 'k1')])
    await presenter.refresh()
    expect(posted).toHaveLength(3)
    expect(posted.at(-1)?.commit.commitId).toBe('c2')
  })

  test('a change that is gone clears the pane', async () => {
    const { presenter, posted, rewrite } = setup([commit('c1', 'k1')])
    await presenter.show('c1')
    rewrite([])
    await presenter.refresh()
    expect(posted.at(-1)).toBeNull()
  })

  test('an older load that finishes late is not posted', async () => {
    const { presenter, posted, holdFiles } = setup([commit('c1', 'k1'), commit('c2', 'k2')])
    const releaseFirst = holdFiles('c1')
    const first = presenter.show('c1')
    await presenter.show('c2')
    releaseFirst()
    await first
    expect(posted.map((d) => d?.commit.commitId)).toEqual(['c2', 'c2'])
  })

  test('forgetting what was posted posts the same detail again', async () => {
    const { presenter, posted } = setup([commit('c1', 'k1')])
    await presenter.show('c1')
    presenter.forgetPosted()
    await presenter.refresh()
    expect(posted.length).toBeGreaterThan(2)
  })
})
