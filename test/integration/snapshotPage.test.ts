import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { GraphFilter, HistoryDepth } from '../../shared/model'
import type { CommitView } from '../../shared/protocol'
import { JjRepo } from '../../src/jj/repo'
import { JjRunner, type RunOptions, type RunResult } from '../../src/jj/runner'
import { RepoModel } from '../../src/repo/repoModel'
import { NULL_LOGGER } from '../../src/util/logger'
import {
  initRepo,
  JJ_BINARY,
  jj,
  makeRepo,
  makeTempDir,
  writeFile,
  type Fixture,
} from '../helpers/jjFixture'

// A refresh after snapshots only reads the page from the shown commits instead of the graph's
// revset. Every test compares the graph it draws with a fresh load from the revset.

type Options = ConstructorParameters<typeof RepoModel>[2]

const OTHER = ['--config', 'user.email=other@ukemi.dev']

let fixture: Fixture
let root: string

beforeEach(() => {
  fixture = makeTempDir()
  root = join(fixture.dir, 'repo')
  initRepo(root)
})

afterEach(() => fixture.cleanup())

interface Watched {
  model: RepoModel
  // How many page loads read from the shown commits, and how many from the graph's revset.
  snapshotPages: () => number
  fullPages: () => number
}

function watchedModel(options: Options = {}): Watched {
  const pages: string[] = []
  class PageRecorder extends JjRunner {
    override run(run: RunOptions): Promise<RunResult> {
      if (run.args[0] === 'log' && run.args.some((arg) => arg.startsWith('--limit='))) {
        pages.push(run.args[run.args.indexOf('-r') + 1] ?? '')
      }
      return super.run(run)
    }
  }
  const model = new RepoModel(
    new JjRepo(root, new PageRecorder(JJ_BINARY, NULL_LOGGER)),
    NULL_LOGGER,
    {
      snapshotPageAfterMs: 0,
      ...options,
    },
  )
  const isSnapshotPage = (revset: string): boolean => revset.includes('working_copies()::')
  return {
    model,
    snapshotPages: () => pages.filter(isSnapshotPage).length,
    fullPages: () => pages.filter((revset) => !isSnapshotPage(revset)).length,
  }
}

async function expectSameAsFullLoad(model: RepoModel, options: Options = {}): Promise<void> {
  const fresh = new RepoModel(makeRepo(root), NULL_LOGGER, options)
  await fresh.refresh()
  expect(model.error).toBeNull()
  expect(model.graph).toEqual(fresh.graph)
}

let edits = 0

// Edits a file in a working copy and refreshes the way the file watcher does.
async function editAndRefresh(model: RepoModel, dir = root): Promise<void> {
  edits += 1
  writeFile(dir, `edit-${edits}.txt`, 'x\n')
  await model.refreshWorkingCopy()
}

const commitOf = (description: string): string =>
  `description(substring:${JSON.stringify(description)})`

describe('snapshot page', () => {
  const presets: Array<[GraphFilter, HistoryDepth]> = [
    ['mine', '7d'],
    ['myHistory', '7d'],
    ['stack', '7d'],
    ['working', '7d'],
    ['recent', 'all'],
  ]

  test.each(presets)(
    'a file edit in %s (%s) reads the page from the shown commits',
    async (filter, depth) => {
      jj(root, 'describe', '-m', 'mine A')
      jj(root, ...OTHER, 'new', '-m', 'other')
      jj(root, 'new')
      const options = { filter, depth }
      const watched = watchedModel(options)
      await watched.model.refresh()

      await editAndRefresh(watched.model)

      expect(watched.snapshotPages()).toBe(1)
      expect(watched.fullPages()).toBe(1)
      await expectSameAsFullLoad(watched.model, options)
    },
  )

  test.each<GraphFilter>(['mine', 'stack', 'myHistory'])(
    'rebased descendants of the working copy follow it in %s',
    async (filter) => {
      jj(root, 'describe', '-m', 'mine A')
      jj(root, 'new', '-m', 'mine B')
      jj(root, 'new', '-m', 'mine C')
      jj(root, 'edit', commitOf('mine B'))
      const options = { filter }
      const watched = watchedModel(options)
      await watched.model.refresh()
      const before = watched.model.graph?.commits.find((c) => c.description === 'mine C\n')

      await editAndRefresh(watched.model)

      const after = watched.model.graph?.commits.find((c) => c.description === 'mine C\n')
      expect(after?.commitId).not.toBe(before?.commitId)
      expect(watched.snapshotPages()).toBe(1)
      await expectSameAsFullLoad(watched.model, options)
    },
  )

  test('a bookmark on the working copy moves with it', async () => {
    jj(root, 'describe', '-m', 'mine A')
    jj(root, 'bookmark', 'create', 'feature', '-r', '@')
    const options = { filter: 'mine' as const }
    const watched = watchedModel(options)
    await watched.model.refresh()

    await editAndRefresh(watched.model)

    const workingCopy = watched.model.graph?.commits.find((c) => c.isWorkingCopy)
    expect(workingCopy?.localBookmarks.map((b) => b.name)).toEqual(['feature'])
    expect(watched.snapshotPages()).toBe(1)
    await expectSameAsFullLoad(watched.model, options)
  })

  test('jj orders the rows again when the rewritten working copy becomes the newest commit', async () => {
    // The working copy sits on an older branch, below a newer one. Its rewrite is the newest
    // commit, which moves its branch to the top.
    jj(root, 'describe', '-m', 'mine old')
    jj(root, 'new', '-m', 'mine old tip')
    jj(root, 'new', 'root()', '-m', 'mine newer')
    jj(root, 'new', '-m', 'mine newer tip')
    jj(root, 'edit', commitOf('mine old tip'))
    const options = { filter: 'mine' as const }
    const watched = watchedModel(options)
    await watched.model.refresh()
    const order = (): string[] => watched.model.graph?.commits.map((c) => c.description) ?? []
    const before = order()

    await editAndRefresh(watched.model)

    expect(order()).not.toEqual(before)
    expect(order()[0]).toBe('mine old tip\n')
    expect(watched.snapshotPages()).toBe(1)
    await expectSameAsFullLoad(watched.model, options)
  })

  test('a snapshot of another workspace reads the page from the shown commits', async () => {
    jj(root, 'describe', '-m', 'mine A')
    jj(root, 'new')
    const other = join(fixture.dir, 'second')
    jj(root, 'workspace', 'add', other, '--name', 'second')
    const options = { filter: 'mine' as const, snapshotOtherWorkspaces: true }
    const watched = watchedModel(options)
    await watched.model.refresh()

    await editAndRefresh(watched.model, other)

    expect(watched.snapshotPages()).toBe(1)
    await expectSameAsFullLoad(watched.model, options)
  })

  describe('reads the page from the revset', () => {
    async function snapshotAfter(
      options: Options,
      prepare: () => void = () => {},
    ): Promise<Watched> {
      jj(root, 'describe', '-m', 'mine A')
      jj(root, ...OTHER, 'new', '-m', 'other')
      jj(root, 'new', '-m', 'mine B')
      jj(root, 'new')
      prepare()
      const watched = watchedModel(options)
      await watched.model.refresh()
      await editAndRefresh(watched.model)
      await expectSameAsFullLoad(watched.model, options)
      return watched
    }

    test('after another operation', async () => {
      jj(root, 'describe', '-m', 'mine A')
      const watched = watchedModel({ filter: 'mine' })
      await watched.model.refresh()

      jj(root, 'describe', '-m', 'mine A again')
      await editAndRefresh(watched.model)

      expect(watched.snapshotPages()).toBe(0)
      await expectSameAsFullLoad(watched.model, { filter: 'mine' })
    })

    test('for Recent with a date window', async () => {
      expect((await snapshotAfter({ filter: 'recent', depth: '7d' })).snapshotPages()).toBe(0)
    })

    test('for a typed revset', async () => {
      expect((await snapshotAfter({ revset: 'mine()' })).snapshotPages()).toBe(0)
    })

    test('for a truncated graph', async () => {
      const watched = await snapshotAfter({ filter: 'mine', pageSize: 2 })
      expect(watched.model.graph?.isTruncated).toBe(true)
      expect(watched.snapshotPages()).toBe(0)
    })

    test('when the revset is fast', async () => {
      const watched = await snapshotAfter({ filter: 'mine', snapshotPageAfterMs: 60_000 })
      expect(watched.snapshotPages()).toBe(0)
    })

    test('when a shown change is divergent', async () => {
      const watched = await snapshotAfter({ filter: 'mine' }, () => {
        const operation = jj(root, 'op', 'log', '-n1', '--no-graph', '-T', 'id').trim()
        jj(root, 'describe', '-r', commitOf('mine B'), '-m', 'mine B one')
        jj(root, '--at-op', operation, 'describe', '-r', commitOf('mine B'), '-m', 'mine B two')
      })
      expect(watched.model.graph?.commits.some((c) => c.isDivergent)).toBe(true)
      expect(watched.snapshotPages()).toBe(0)
    })

    test('after the view changed', async () => {
      jj(root, 'describe', '-m', 'mine A')
      const watched = watchedModel({ filter: 'mine' })
      await watched.model.refresh()

      writeFile(root, 'x.txt', 'x\n')
      watched.model.markDirty()
      await watched.model.setView('stack', '7d')

      expect(watched.snapshotPages()).toBe(0)
      await expectSameAsFullLoad(watched.model, { filter: 'stack' })
    })
  })

  describe('elision lookups after a snapshot', () => {
    const OLD = ['--config', 'debug.commit-timestamp=2020-01-01T00:00:00Z']

    function lookupModel(options: Options): { model: RepoModel; lookups: () => number } {
      let count = 0
      class LookupCounter extends JjRunner {
        override run(run: RunOptions): Promise<RunResult> {
          if (run.args.some((arg) => /^heads\(::[0-9a-f]{40} & |revset\(/.test(arg))) {
            count += 1
          }
          return super.run(run)
        }
      }
      const repo = new JjRepo(root, new LookupCounter(JJ_BINARY, NULL_LOGGER))
      return { model: new RepoModel(repo, NULL_LOGGER, options), lookups: () => count }
    }

    test.each<[string, Options]>([
      ['Recent with a date window', { filter: 'recent', depth: '7d' }],
      ['a typed revset', { revset: 'mine()' }],
    ])('%s keeps them when only the working copy was rewritten', async (_name, options) => {
      // Two old commits below the working copy: the date window shows the newer one, as the
      // parent of the window's first commit, and elides the older one.
      jj(root, ...OLD, 'describe', '-m', 'mine old 1')
      jj(root, ...OLD, ...OTHER, 'new', '-m', 'other old 2')
      jj(root, 'new', '-m', 'mine new')
      jj(root, 'new')
      const { model, lookups } = lookupModel(options)
      await model.refresh()
      const first = lookups()
      expect(first).toBeGreaterThan(0)

      await editAndRefresh(model)

      expect(lookups()).toBe(first)
      await expectSameAsFullLoad(model, options)
    })

    test('a typed revset looks up again when the snapshot brought a commit into view', async () => {
      // The revset leaves out the newest commit. That is C until the working copy W, rewritten
      // by the snapshot, becomes the newest, so C joins the graph. Q's elided parent P then
      // leads to C, where before it led nowhere.
      const at = (date: string): string[] => [
        '--config',
        `debug.commit-timestamp=${date}T00:00:00Z`,
      ]
      jj(root, ...at('2021-01-01'), 'describe', '-m', 'mine W')
      jj(root, ...at('2025-01-01'), 'new', 'root()', '-m', 'mine C')
      jj(root, ...at('2020-01-01'), ...OTHER, 'new', '-m', 'other P')
      jj(root, ...at('2024-01-01'), 'new', '-m', 'mine Q')
      jj(root, 'edit', commitOf('mine W'))
      const options = { revset: '(mine() & mutable()) ~ latest(mutable(), 1)' }
      const { model, lookups } = lookupModel(options)
      const mineQ = (): CommitView | undefined =>
        model.graph?.commits.find((c) => c.description === 'mine Q\n')
      await model.refresh()
      expect(model.graph?.commits.some((c) => c.description === 'mine C\n')).toBe(false)
      expect(mineQ()?.row.outgoing).toEqual([])
      const first = lookups()

      await editAndRefresh(model)

      expect(model.graph?.commits.some((c) => c.description === 'mine C\n')).toBe(true)
      expect(mineQ()?.row.outgoing.map((edge) => edge.isElided)).toEqual([true])
      expect(lookups()).toBeGreaterThan(first)
      await expectSameAsFullLoad(model, options)
    })
  })
})
