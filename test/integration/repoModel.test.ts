import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { isVersionAtLeast, parseVersion } from '../../src/jj/parse'
import { GRAPH_PAGE_SIZE, JjRepo, TEMPLATE_REVSET_VERSION } from '../../src/jj/repo'
import { JjRunner, type RunOptions, type RunResult } from '../../src/jj/runner'
import { RepoModel } from '../../src/repo/repoModel'
import { NULL_LOGGER, type Logger } from '../../src/util/logger'
import {
  initRepo,
  JJ_BINARY,
  jj,
  makeRepo,
  makeTempDir,
  writeFile,
  type Fixture,
} from '../helpers/jjFixture'

// The graph asks for one commit more than a page, to tell whether more exist.
const GRAPH_LOAD = `--limit=${GRAPH_PAGE_SIZE + 1}`

// Batched elision lookups need a jj whose templates evaluate revsets. CI also runs an older jj.
const installedJj = parseVersion(execFileSync(JJ_BINARY, ['--version'], { encoding: 'utf8' }))
const canBatchWithInstalledJj =
  installedJj !== null && isVersionAtLeast(installedJj, TEMPLATE_REVSET_VERSION)

let fixture: Fixture
let root: string
let model: RepoModel

beforeEach(() => {
  fixture = makeTempDir()
  root = join(fixture.dir, 'repo')
  initRepo(root)
  model = new RepoModel(makeRepo(root), NULL_LOGGER)
})

afterEach(() => fixture.cleanup())

describe('RepoModel', () => {
  test('builds graph state with layout rows and working copy files', async () => {
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'base')
    jj(root, 'new')
    writeFile(root, 'b.txt', 'b\n')

    await model.refresh()

    const graph = model.graph
    expect(model.error).toBeNull()
    expect(graph?.commits).toHaveLength(2)
    expect(graph?.commits[0]?.isWorkingCopy).toBe(true)
    expect(graph?.commits[0]?.row.outgoing).toEqual([{ toColumn: 0, isElided: false }])
    expect(graph?.workingCopyFiles.map((f) => f.path)).toEqual(['b.txt'])
    expect(graph?.canUndo).toBe(true)
    expect(graph?.hasRemotes).toBe(false)
  })

  test('a commit id from before a snapshot still names its change', async () => {
    await model.refresh()
    const before = model.graph?.commits.find((c) => c.isWorkingCopy)
    writeFile(root, 'late.txt', 'x\n')
    model.markDirty()
    await model.refresh()

    const after = model.graph?.commits.find((c) => c.isWorkingCopy)
    expect(after?.commitId).not.toBe(before?.commitId)
    expect(model.latestCommit(before?.commitId ?? '')?.commitId).toBe(after?.commitId)
    expect(model.revisionFor(before?.commitId ?? '')).toBe(after?.changeId)
    expect(model.latestCommit('0'.repeat(40))).toBeUndefined()
  })

  test('describing a working copy that changed since the refresh keeps one change', async () => {
    await model.refresh()
    const before = model.graph?.commits.find((c) => c.isWorkingCopy)
    writeFile(root, 'late.txt', 'x\n')

    await model.repo.describe(model.revisionFor(before?.commitId ?? ''), 'late')
    model.markDirty()
    await model.refresh()

    const same = model.graph?.commits.filter((c) => c.changeId === before?.changeId) ?? []
    expect(same).toHaveLength(1)
    expect(same[0]?.isDivergent).toBe(false)
    expect(same[0]?.description).toBe('late\n')
  })

  test('a command that lands during a refresh shows up on the next one', async () => {
    jj(root, 'describe', '-m', 'before')
    // The command lands after the refresh read the head operation and before it read the graph.
    let landed = false
    class RacingRunner extends JjRunner {
      override async run(options: RunOptions): Promise<RunResult> {
        const result = await super.run(options)
        if (options.args[0] === 'op' && !landed) {
          landed = true
          jj(root, 'describe', '-m', 'during')
        }
        return result
      }
    }
    const racing = new RepoModel(
      new JjRepo(root, new RacingRunner(JJ_BINARY, NULL_LOGGER)),
      NULL_LOGGER,
    )

    await racing.refresh()
    // Every read of that refresh saw the operation it started from.
    expect(racing.graph?.commits.find((c) => c.isWorkingCopy)?.description).toBe('before\n')
    // The watcher reports the command's operation.
    await racing.refreshIfOperationChanged()

    expect(landed).toBe(true)
    expect(racing.graph?.commits.find((c) => c.isWorkingCopy)?.description).toBe('during\n')
  })

  test('a refresh reads the operation log once and keeps the remotes', async () => {
    const commands: string[] = []
    const logger = { ...NULL_LOGGER, info: (line: string) => commands.push(line) }
    const counted = new RepoModel(new JjRepo(root, new JjRunner(JJ_BINARY, logger)), NULL_LOGGER)
    jj(root, 'git', 'remote', 'add', 'origin', 'https://example.com/x.git')

    await counted.refresh()

    expect(commands.filter((line) => line.includes(' jj op log '))).toHaveLength(1)
    expect(counted.remotes?.map((remote) => remote.name)).toEqual(['origin'])
  })

  test('picks up file changes only after markDirty', async () => {
    await model.refresh()
    writeFile(root, 'late.txt', 'x\n')

    await model.refresh()
    expect(model.graph?.workingCopyFiles).toEqual([])

    model.markDirty()
    await model.refresh()
    expect(model.graph?.workingCopyFiles.map((f) => f.path)).toEqual(['late.txt'])
  })

  test('coalesces concurrent refreshes and notifies listeners', async () => {
    let calls = 0
    model.onDidChange(() => calls++)

    await Promise.all([model.refresh(), model.refresh(), model.refresh()])
    await model.refresh()

    expect(calls).toBeGreaterThanOrEqual(2)
    expect(calls).toBeLessThanOrEqual(3)
  })

  test('waits for a refresh queued during the load', async () => {
    await model.refresh()
    let nested = false
    model.onDidChange(() => {
      if (nested) {
        return
      }
      nested = true
      writeFile(root, 'during.txt', 'z\n')
      model.markDirty()
      void model.refresh()
    })
    writeFile(root, 'before.txt', 'y\n')
    model.markDirty()

    await model.refresh()

    expect(model.graph?.workingCopyFiles.map((file) => file.path).sort()).toEqual([
      'before.txt',
      'during.txt',
    ])
  })

  test('reports errors instead of throwing', async () => {
    fixture.cleanup()

    await model.refresh()

    expect(model.error).not.toBeNull()
  })

  test('does not reload the graph when the operation is unchanged', async () => {
    const lines: string[] = []
    const logger: Logger = {
      info: (message) => {
        lines.push(message)
      },
      warn: () => undefined,
      error: () => undefined,
    }
    const watched = new RepoModel(new JjRepo(root, new JjRunner(JJ_BINARY, logger)), logger)
    await watched.refresh()
    const graphLoads = () => lines.filter((line) => line.includes(GRAPH_LOAD)).length
    const before = graphLoads()

    await watched.refreshIfOperationChanged()

    expect(graphLoads()).toBe(before)
    expect(watched.error).toBeNull()
  })

  test('reloads the working copy only when the snapshot records an operation', async () => {
    const lines: string[] = []
    const logger: Logger = {
      info: (message) => {
        lines.push(message)
      },
      warn: () => undefined,
      error: () => undefined,
    }
    const watched = new RepoModel(new JjRepo(root, new JjRunner(JJ_BINARY, logger)), logger)
    await watched.refresh()
    const graphLoads = () => lines.filter((line) => line.includes(GRAPH_LOAD)).length
    const before = graphLoads()

    await watched.refreshWorkingCopy()
    expect(graphLoads()).toBe(before)

    writeFile(root, 'a.txt', 'a\n')
    await watched.refreshWorkingCopy()
    expect(graphLoads()).toBe(before + 1)
    expect(watched.graph?.workingCopyFiles.map((file) => file.path)).toEqual(['a.txt'])

    await watched.refresh()
    expect(graphLoads()).toBe(before + 2)
  })

  test('reloads the graph once for a burst of operation events', async () => {
    const lines: string[] = []
    const logger: Logger = {
      info: (message) => {
        lines.push(message)
      },
      warn: () => undefined,
      error: () => undefined,
    }
    const watched = new RepoModel(new JjRepo(root, new JjRunner(JJ_BINARY, logger)), logger)
    await watched.refresh()
    const graphLoads = () => lines.filter((line) => line.includes(GRAPH_LOAD)).length
    const before = graphLoads()
    jj(root, 'describe', '-m', 'external')

    await Promise.all([1, 2, 3, 4].map(() => watched.refreshIfOperationChanged()))

    expect(graphLoads()).toBe(before + 1)
    expect(watched.graph?.commits[0]?.description).toBe('external\n')
  })

  test('refreshes after an external jj command', async () => {
    await model.refresh()
    jj(root, 'describe', '-m', 'external')

    await model.refreshIfOperationChanged()

    expect(model.graph?.commits[0]?.description).toBe('external\n')
  })

  test('marks bookmarks that were never pushed as unsynced', async () => {
    const remote = join(fixture.dir, 'remote.git')
    execFileSync('git', ['init', '--bare', '-q', remote])
    jj(root, 'git', 'remote', 'add', 'origin', remote)
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'pushed')
    jj(root, 'bookmark', 'set', 'pushed', '-r', '@')
    jj(root, 'git', 'push', '--bookmark', 'pushed')
    jj(root, 'new', '-m', 'local only')
    writeFile(root, 'b.txt', 'b\n')
    jj(root, 'bookmark', 'set', 'local-only', '-r', '@')

    await model.refresh()

    const bookmarks = model.graph?.commits.flatMap((c) => c.localBookmarks) ?? []
    expect(bookmarks.find((b) => b.name === 'pushed')?.synced).toBe(true)
    expect(bookmarks.find((b) => b.name === 'local-only')?.synced).toBe(false)
    expect(model.graph?.hasUnpushed).toBe(true)
    expect(
      model.bookmarks.map((bookmark) => `${bookmark.remote ?? 'local'}:${bookmark.name}`).sort(),
    ).toEqual(['local:local-only', 'local:pushed', 'origin:pushed'])
  })

  test('counts how far the current bookmarks are ahead of and behind their remotes', async () => {
    const remote = join(fixture.dir, 'remote.git')
    execFileSync('git', ['init', '--bare', '-q', remote])
    jj(root, 'git', 'remote', 'add', 'origin', remote)
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'pushed')
    jj(root, 'bookmark', 'set', 'feature', '-r', '@')
    jj(root, 'git', 'push', '--bookmark', 'feature')
    jj(root, 'new', '-m', 'one more')
    writeFile(root, 'b.txt', 'b\n')
    jj(root, 'new', '-m', 'and another')
    writeFile(root, 'c.txt', 'c\n')
    jj(root, 'bookmark', 'set', 'feature', '-r', '@')
    jj(root, 'bookmark', 'set', 'local-only', '-r', '@')

    await model.refresh()

    expect(model.graph?.tracking).toEqual([
      { name: 'feature', remote: 'origin', tracked: true, ahead: 2, behind: 0 },
    ])
    expect(model.graph?.operationId).toMatch(/^[0-9a-f]+$/)
  })

  test('treats bookmarks as synced when the repository has no remote', async () => {
    jj(root, 'bookmark', 'set', 'solo', '-r', '@')

    await model.refresh()

    expect(model.graph?.commits[0]?.localBookmarks).toEqual([
      { name: 'solo', synced: true, conflict: false },
    ])
    expect(model.graph?.hasUnpushed).toBe(false)
  })

  test('knows when redo is possible', async () => {
    jj(root, 'describe', '-m', 'one')
    await model.refresh()
    expect(model.graph?.canRedo).toBe(false)

    jj(root, 'undo')
    await model.refresh()
    expect(model.graph?.canRedo).toBe(true)

    jj(root, 'redo')
    await model.refresh()
    expect(model.graph?.canRedo).toBe(false)
  })

  test('finds the bookmarks of the current stack', async () => {
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'describe', '-m', 'feature')
    jj(root, 'bookmark', 'set', 'feature', '-r', '@')
    jj(root, 'new')

    await model.refresh()

    expect(model.graph?.currentBookmarks).toEqual(['feature'])
  })

  test('uses the default filter from the options', async () => {
    const stackModel = new RepoModel(makeRepo(root), NULL_LOGGER, { filter: 'stack', depth: '14d' })

    await stackModel.refresh()

    expect(stackModel.graph?.filter).toBe('stack')
    expect(stackModel.graph?.depth).toBe('14d')
  })

  test('shows a short first-parent chain for the working copy filter', async () => {
    writeFile(root, 'base.txt', 'base\n')
    jj(root, 'describe', '-m', 'base')
    jj(root, 'bookmark', 'set', 'main', '-r', '@')
    jj(root, 'new', 'main', '-m', 'side')
    const side = jj(root, 'log', '--no-graph', '-r', '@', '-T', 'commit_id')
    jj(root, 'new', 'main', '-m', 'one')
    for (const name of ['two', 'three', 'four', 'five', 'six', 'seven']) {
      jj(root, 'new', '-m', name)
    }
    jj(root, 'new', '@', side, '-m', 'merge')
    const working = new RepoModel(makeRepo(root), NULL_LOGGER, { filter: 'working' })

    await working.refresh()

    expect(working.graph?.commits.map((c) => c.description.trim())).toEqual([
      'merge',
      'seven',
      'six',
      'five',
      'four',
      'three',
    ])
  })

  test('shows the immutable base under a short working copy chain', async () => {
    writeFile(root, 'older.txt', 'older\n')
    jj(root, 'describe', '-m', 'older')
    jj(root, 'new', '-m', 'base')
    jj(root, 'bookmark', 'set', 'base', '-r', '@')
    jj(root, 'new', '-m', 'work')
    jj(root, 'config', 'set', '--repo', 'revset-aliases."immutable_heads()"', 'base')
    const working = new RepoModel(makeRepo(root), NULL_LOGGER, { filter: 'working' })

    await working.refresh()

    expect(working.graph?.commits.map((c) => c.description.trim())).toEqual(['work', 'base'])
  })

  test('reports working-copy line counts only when enabled', async () => {
    writeFile(root, 'b.txt', 'b\n')
    jj(root, 'describe', '-m', 'base')
    jj(root, 'new')
    writeFile(root, 'b.txt', 'b\nextra\n')
    await model.refresh()
    const id = model.graph?.commits.find((commit) => commit.isWorkingCopy)?.commitId ?? ''
    const before = model.graph?.workingCopyFiles.find((file) => file.path === 'b.txt')

    expect(before?.linesAdded).toBeUndefined()
    expect(before?.linesRemoved).toBeUndefined()

    await model.setShowLineStats(true)

    expect(model.graph?.workingCopyFiles.find((file) => file.path === 'b.txt')).toMatchObject({
      linesAdded: 1,
      linesRemoved: 0,
    })
    expect((await model.filesFor(id)).find((file) => file.path === 'b.txt')).toMatchObject({
      linesAdded: 1,
      linesRemoved: 0,
    })
  })

  test('caches file lists by commit id', async () => {
    writeFile(root, 'a.txt', 'a\n')
    await model.refresh()
    const id = model.graph?.commits[0]?.commitId ?? ''

    const first = await model.filesFor(id)
    const second = await model.filesFor(id)

    expect(second).toBe(first)
  })

  test('shares an evolution until the operation log moves', async () => {
    await model.refresh()
    const id = model.graph?.commits.find((commit) => commit.isWorkingCopy)?.commitId ?? ''

    const first = model.evolutionFor(id)
    expect(model.evolutionFor(id)).toBe(first)

    writeFile(root, 'a.txt', 'a\n')
    model.markDirty()
    await model.refresh()
    expect(model.evolutionFor(id)).not.toBe(first)
  })
})

describe('RepoModel paging', () => {
  const ELISION_LOOKUP = /heads\(::[0-9a-f]{40} & /

  function chain(length: number): void {
    for (let i = 0; i < length; i++) {
      jj(root, 'new', '-m', `c${i}`)
    }
  }

  function countingModel(options: ConstructorParameters<typeof RepoModel>[2]): {
    model: RepoModel
    commands: string[]
  } {
    const commands: string[] = []
    const logger = { ...NULL_LOGGER, info: (line: string) => commands.push(line) }
    const repo = new JjRepo(root, new JjRunner(JJ_BINARY, logger))
    return { model: new RepoModel(repo, NULL_LOGGER, options), commands }
  }

  test('loads one page, says it is truncated and loads more on request', async () => {
    chain(5)
    const { model: paged, commands } = countingModel({ depth: 'all', pageSize: 2 })

    await paged.refresh()

    expect(paged.graph?.commits).toHaveLength(2)
    expect(paged.graph?.isTruncated).toBe(true)
    // The parent past the end keeps a plain edge, and costs no elision lookup.
    expect(paged.graph?.commits[1]?.row.outgoing).toEqual([{ toColumn: 0, isElided: false }])
    expect(commands.filter((line) => ELISION_LOOKUP.test(line))).toEqual([])

    await paged.loadMore()
    expect(paged.graph?.commits).toHaveLength(4)

    await paged.refresh()
    expect(paged.graph?.commits).toHaveLength(4)

    await paged.loadMore()
    await paged.loadMore()
    expect(paged.graph?.isTruncated).toBe(false)
    const shown = paged.graph?.commits.length ?? 0
    await paged.loadMore()
    expect(paged.graph?.commits).toHaveLength(shown)
  })

  test('a new view starts from one page again', async () => {
    chain(5)
    const paged = new RepoModel(makeRepo(root), NULL_LOGGER, { depth: 'all', pageSize: 2 })
    await paged.refresh()
    await paged.loadMore()
    expect(paged.graph?.commits).toHaveLength(4)

    await paged.setView('recent', 'all')

    expect(paged.graph?.commits).toHaveLength(2)
    expect(paged.graph?.isTruncated).toBe(true)
  })

  test('a graph that fits is not truncated', async () => {
    chain(1)
    await model.refresh()

    expect(model.graph?.isTruncated).toBe(false)
  })

  test('a snapshot reuses the elision lookups, and another operation runs them again', async () => {
    // mine: A, then two commits by someone else, then the working copy. The graph shows the
    // working copy's parent as the root's parent, so the edge from there to A is elided.
    jj(root, 'describe', '-m', 'mine A')
    for (const message of ['other 1', 'other 2']) {
      jj(root, '--config', 'user.email=other@ukemi.dev', 'new', '-m', message)
    }
    jj(root, 'new')
    const { model: mine, commands } = countingModel({ filter: 'mine' })
    const lookups = (): number => commands.filter((line) => ELISION_LOOKUP.test(line)).length

    await mine.refresh()
    expect(mine.graph?.commits.some((c) => c.row.outgoing.some((edge) => edge.isElided))).toBe(true)
    const first = lookups()
    expect(first).toBeGreaterThan(0)

    writeFile(root, 'edit.txt', 'x\n')
    mine.markDirty()
    await mine.refresh()
    expect(mine.graph?.workingCopyFiles.map((f) => f.path)).toEqual(['edit.txt'])
    expect(lookups()).toBe(first)

    jj(root, 'describe', '-r', '@-', '-m', 'other 2b')
    await mine.refresh()
    expect(lookups()).toBeGreaterThan(first)
  })

  test('an untruncated graph looks up elided parents among the shown commits', async () => {
    jj(root, 'describe', '-m', 'mine A')
    jj(root, '--config', 'user.email=other@ukemi.dev', 'new', '-m', 'other')
    jj(root, 'new')
    const lookups: string[] = []
    class RecordingRunner extends JjRunner {
      override run(options: RunOptions): Promise<RunResult> {
        lookups.push(...options.args.filter((arg) => ELISION_LOOKUP.test(arg)))
        return super.run(options)
      }
    }
    const mine = new RepoModel(
      new JjRepo(root, new RecordingRunner(JJ_BINARY, NULL_LOGGER)),
      NULL_LOGGER,
      { filter: 'mine' },
    )

    await mine.refresh()

    const shown = mine.graph?.commits.map((c) => c.commitId) ?? []
    expect(lookups).toHaveLength(1)
    expect(lookups[0]).toBe(
      `heads(::${mine.graph?.commits[0]?.parents[0]} & (${shown.join(' | ')}))`,
    )
    // The working copy's elided parent leads to A.
    const workingCopy = mine.graph?.commits.find((c) => c.isWorkingCopy)
    expect(workingCopy?.row.outgoing).toEqual([{ toColumn: 0, isElided: true }])
    expect(mine.graph?.commits.map((c) => c.description)).toEqual(['', 'mine A\n'])
  })

  test('a truncated graph looks up elided parents in its revset', async () => {
    // mine: A, then a commit by someone else, then B, C and the working copy. A page of three
    // shows the working copy, C and B, whose parent is elided, and leaves A past the end.
    jj(root, 'describe', '-m', 'mine A')
    jj(root, '--config', 'user.email=other@ukemi.dev', 'new', '-m', 'other')
    jj(root, 'new', '-m', 'mine B')
    jj(root, 'new', '-m', 'mine C')
    jj(root, 'new')
    const { model: paged, commands } = countingModel({ filter: 'mine', pageSize: 3 })

    await paged.refresh()

    expect(paged.graph?.isTruncated).toBe(true)
    const lookups = commands.filter((line) => ELISION_LOOKUP.test(line))
    expect(lookups).toHaveLength(1)
    expect(lookups[0]).toContain('mine()')
  })

  describe('batched elision lookups', () => {
    // mine: A and B side by side, joined by someone else's merge with D on top, and C, someone
    // else's commit and E on another branch. D's elided parent leads to both A and B, and E's to
    // C, so one graph has two lookups, one of them with two edges.
    function twoElidedParents(): void {
      const other = ['--config', 'user.email=other@ukemi.dev']
      jj(root, 'describe', '-m', 'mine A')
      jj(root, 'new', 'root()', '-m', 'mine B')
      jj(root, ...other, 'new', 'description(substring:"mine A")', '@', '-m', 'other merge')
      jj(root, 'new', '-m', 'mine D')
      jj(root, 'new', 'root()', '-m', 'mine C')
      jj(root, ...other, 'new', '-m', 'other')
      jj(root, 'new', '-m', 'mine E')
    }

    interface Recorded {
      model: RepoModel
      args: string[][]
      warnings: string[]
    }

    function recordingModel(options: { version?: string; failBatch?: boolean } = {}): Recorded {
      const args: string[][] = []
      class TestRunner extends JjRunner {
        override version(): ReturnType<JjRunner['version']> {
          if (options.version === undefined) {
            return super.version()
          }
          const [major = 0, minor = 0, patch = 0] = options.version.split('.').map(Number)
          return Promise.resolve({ major, minor, patch })
        }
        override async run(run: RunOptions): Promise<RunResult> {
          args.push([...run.args])
          if (options.failBatch && run.args.some((arg) => arg.includes('revset('))) {
            throw new Error('batch failed')
          }
          return super.run(run)
        }
      }
      const warnings: string[] = []
      const logger: Logger = { ...NULL_LOGGER, warn: (line) => warnings.push(line) }
      const model = new RepoModel(
        new JjRepo(root, new TestRunner(JJ_BINARY, NULL_LOGGER)),
        logger,
        {
          filter: 'mine',
        },
      )
      return { model, args, warnings }
    }

    const batches = (args: string[][]): number =>
      args.filter((run) => run.some((arg) => arg.includes('revset('))).length
    const separateLookups = (args: string[][]): number =>
      args.filter((run) => run.some((arg) => ELISION_LOOKUP.test(arg))).length

    test.skipIf(!canBatchWithInstalledJj)(
      'one jj process draws the same graph as one lookup per parent',
      async () => {
        twoElidedParents()
        const batched = recordingModel()
        const separate = recordingModel({ version: '0.46.0' })

        await batched.model.refresh()
        await separate.model.refresh()

        expect(batches(batched.args)).toBe(1)
        expect(separateLookups(batched.args)).toBe(0)
        expect(batches(separate.args)).toBe(0)
        expect(separateLookups(separate.args)).toBe(2)
        expect(batched.model.graph).toEqual(separate.model.graph)
        const mineD = batched.model.graph?.commits.find((c) => c.description === 'mine D\n')
        expect(mineD?.row.outgoing.filter((edge) => edge.isElided)).toHaveLength(2)
      },
    )

    test('a failed batch falls back to one lookup per parent', async () => {
      twoElidedParents()
      // The batch fails before jj runs it, so any installed jj will do.
      const failing = recordingModel({ version: '0.47.0', failBatch: true })
      const separate = recordingModel({ version: '0.46.0' })

      await failing.model.refresh()
      await separate.model.refresh()

      expect(batches(failing.args)).toBe(1)
      expect(separateLookups(failing.args)).toBe(2)
      expect(failing.warnings.some((line) => line.includes('batched elision lookup'))).toBe(true)
      expect(failing.model.graph).toEqual(separate.model.graph)
    })
  })

  test('a failed elision lookup keeps the edge from the last refresh', async () => {
    jj(root, 'describe', '-m', 'base')
    jj(root, 'new', '-m', 'hidden')
    jj(root, 'new')
    const baseId = jj(root, 'log', '--no-graph', '-r', '@--', '-T', 'commit_id').trim()
    let failLookups = false
    class FailingRunner extends JjRunner {
      override async run(options: RunOptions): Promise<RunResult> {
        if (failLookups && options.args.some((arg) => ELISION_LOOKUP.test(arg))) {
          throw new Error('lookup failed')
        }
        return super.run(options)
      }
    }
    const warnings: string[] = []
    const logger: Logger = { ...NULL_LOGGER, warn: (line) => warnings.push(line) }
    const elided = new RepoModel(
      new JjRepo(root, new FailingRunner(JJ_BINARY, NULL_LOGGER)),
      logger,
      {
        revset: baseId,
      },
    )
    await elided.refresh()
    const elidedEdge = [{ toColumn: 0, isElided: true }]
    expect(elided.graph?.commits[0]?.row.outgoing).toEqual(elidedEdge)

    failLookups = true
    jj(root, 'describe', '-m', 'top')
    await elided.refresh()

    expect(elided.graph?.commits[0]?.description).toBe('top\n')
    expect(elided.graph?.commits[0]?.row.outgoing).toEqual(elidedEdge)
    expect(warnings.some((line) => line.includes('looking up the ancestors'))).toBe(true)
  })
})

describe('RepoModel forge state', () => {
  const forge = { kind: 'github' as const, host: 'github.com', isSignedIn: true }
  const request = {
    number: 7,
    title: 'Feature',
    url: 'https://github.com/o/r/pull/7',
    state: 'open' as const,
    ci: 'none' as const,
    isMine: true,
    checks: [],
    headBranch: 'feature',
    baseBranch: 'main',
  }

  test('keeps the requests of a failed refresh marked stale until one succeeds', async () => {
    jj(root, 'bookmark', 'set', 'feature', '-r', '@')
    await model.refresh()
    model.setForge(forge, [request])

    model.markForgeStale('HTTP 502')
    const bookmarked = () => model.graph?.commits.find((c) => c.isWorkingCopy)

    expect(model.graph?.forge?.refreshError).toBe('HTTP 502')
    expect(bookmarked()?.requests.map((r) => r.number)).toEqual([7])

    model.setForge(forge, [request])
    expect(model.graph?.forge?.refreshError).toBeUndefined()
  })

  test('marks nothing without a forge', async () => {
    await model.refresh()

    model.markForgeStale('HTTP 502')

    expect(model.graph?.forge).toBeNull()
  })
})
