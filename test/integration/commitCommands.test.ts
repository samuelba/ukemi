import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { commitCommands } from '../../src/app/commands/commitCommands'
import { bookmarkPointsElsewhere } from '../../src/app/commands/requestCommands'
import type { CommandEnv } from '../../src/app/commands/context'
import { Operations } from '../../src/app/operations'
import { RepoModel } from '../../src/repo/repoModel'
import { NULL_LOGGER } from '../../src/util/logger'
import { initRepo, jj, makeRepo, makeTempDir, writeFile, type Fixture } from '../helpers/jjFixture'

let fixture: Fixture
let root: string
let model: RepoModel
let warnings: string[]
let infos: string[]

beforeEach(() => {
  fixture = makeTempDir()
  root = join(fixture.dir, 'repo')
  initRepo(root)
  model = new RepoModel(makeRepo(root), NULL_LOGGER, { filter: 'mine' })
  warnings = []
  infos = []
})

afterEach(() => fixture.cleanup())

function commands(picked?: string, typed?: string): ReturnType<typeof commitCommands> {
  const env = {
    registry: { modelFor: () => model, activeModel: model },
    operations: new Operations(NULL_LOGGER),
    logger: NULL_LOGGER,
    ui: {
      warn: async (text: string) => {
        warnings.push(text)
        return undefined
      },
      info: async (text: string) => {
        infos.push(text)
        return undefined
      },
      pickOrType: () => ({ choice: Promise.resolve(picked) }),
      input: async () => typed,
    },
  } as unknown as CommandEnv
  return commitCommands(env)
}

function description(revset: string): string {
  return jj(root, 'log', '-r', revset, '--no-graph', '-T', 'description')
}

describe('squash', () => {
  test('keeps the description of a parent the graph elides', async () => {
    writeFile(root, 'm.txt', 'm\n')
    jj(root, 'describe', '-m', 'mine')
    jj(root, 'new', '-m', 'parent')
    writeFile(root, 'p.txt', 'p\n')
    jj(root, 'metaedit', '--author', 'Someone Else <else@ukemi.dev>')
    jj(root, 'new', '-m', 'child')
    writeFile(root, 'c.txt', 'c\n')
    await model.refresh()
    const child = model.graph?.commits.find((c) => c.isWorkingCopy)
    expect(child).toBeDefined()
    expect(model.findCommit(child?.parents[0] ?? '')).toBeUndefined()

    await commands()['ukemi.commit.squash']?.({ commitId: child?.commitId })

    expect(warnings).toEqual([])
    expect(description('@-')).toBe('parent\n\nchild\n')
  })
})

describe('squash into', () => {
  function setup(): void {
    writeFile(root, 't.txt', 't\n')
    jj(root, 'describe', '-m', 'target')
    jj(root, 'bookmark', 'set', 'feature', '-r', '@')
    jj(root, 'new', '-m', 'middle')
    writeFile(root, 'm.txt', 'm\n')
    jj(root, 'new', '-m', 'source')
    writeFile(root, 's.txt', 's\n')
  }

  test('squashes into a typed bookmark with both descriptions', async () => {
    setup()
    await model.refresh()
    const source = model.graph?.commits.find((c) => c.isWorkingCopy)

    await commands('feature')['ukemi.commit.squashInto']?.({ commitId: source?.commitId })

    expect(warnings).toEqual([])
    expect(description('feature')).toBe('target\n\nsource\n')
    expect(jj(root, 'file', 'list', '-r', 'feature')).toContain('s.txt')
    expect(description('@-')).toBe('middle\n')
  })

  test('refuses an immutable destination', async () => {
    setup()
    await model.refresh()
    const source = model.graph?.commits.find((c) => c.isWorkingCopy)

    await commands('root()')['ukemi.commit.squashInto']?.({ commitId: source?.commitId })

    expect(description('feature')).toBe('target\n')
  })

  test('does nothing when the pick is dismissed', async () => {
    setup()
    await model.refresh()
    const source = model.graph?.commits.find((c) => c.isWorkingCopy)

    await commands(undefined)['ukemi.commit.squashInto']?.({ commitId: source?.commitId })

    expect(description('@')).toBe('source\n')
    expect(description('feature')).toBe('target\n')
  })
})

describe('request bookmark', () => {
  test('tells a bookmark on another change from one on the change', async () => {
    jj(root, 'describe', '-m', 'old')
    jj(root, 'bookmark', 'set', 'feature', '-r', '@')
    jj(root, 'new', '-m', 'new')
    writeFile(root, 'n.txt', 'n\n')
    await model.refresh()
    const commit = model.graph?.commits.find((c) => c.isWorkingCopy)
    if (!commit) {
      throw new Error('no working copy')
    }

    expect(await bookmarkPointsElsewhere(model.repo, 'feature', commit)).toBe(true)
    expect(await bookmarkPointsElsewhere(model.repo, 'other', commit)).toBe(false)

    jj(root, 'bookmark', 'set', 'feature', '-r', '@')
    writeFile(root, 'n.txt', 'edited after the refresh\n')
    expect(await bookmarkPointsElsewhere(model.repo, 'feature', commit)).toBe(false)
  })
})

describe('absorb', () => {
  test('moves the lines into the ancestor that last changed them', async () => {
    writeFile(root, 'f.txt', 'one\ntwo\n')
    jj(root, 'commit', '-m', 'base')
    writeFile(root, 'f.txt', 'one\nTWO\n')
    await model.refresh()
    const workingCopy = model.graph?.commits.find((c) => c.isWorkingCopy)

    await commands()['ukemi.commit.absorb']?.({ commitId: workingCopy?.commitId })

    expect(warnings).toEqual([])
    expect(infos).toEqual([])
    expect(jj(root, 'file', 'show', '-r', 'description(exact:"base\n")', 'f.txt')).toBe(
      'one\nTWO\n',
    )
    expect(jj(root, 'diff', '-r', '@', '--summary')).toBe('')
  })

  test('says so when no ancestor takes the lines', async () => {
    writeFile(root, 'new.txt', 'only in the working copy\n')
    await model.refresh()
    const workingCopy = model.graph?.commits.find((c) => c.isWorkingCopy)

    await commands()['ukemi.commit.absorb']?.({ commitId: workingCopy?.commitId })

    expect(infos).toHaveLength(1)
    expect(infos[0]).toContain('nothing to absorb')
    expect(jj(root, 'diff', '-r', '@', '--summary')).toBe('A new.txt\n')
  })
})

describe('metadata', () => {
  function workingCopyId(): string | undefined {
    return model.graph?.commits.find((c) => c.isWorkingCopy)?.commitId
  }

  function show(template: string): string {
    return jj(root, 'log', '-r', '@', '--no-graph', '-T', template)
  }

  beforeEach(async () => {
    writeFile(root, 'f.txt', 'f\n')
    jj(root, 'describe', '-m', 'work')
    await model.refresh()
  })

  test('sets the author and resets it to the configured user', async () => {
    await commands(undefined, ' Someone Else <else@ukemi.dev> ')['ukemi.commit.setAuthor']?.({
      commitId: workingCopyId(),
    })
    expect(show('author.name() ++ " " ++ author.email()')).toBe('Someone Else else@ukemi.dev')

    await commands()['ukemi.commit.resetAuthor']?.({ commitId: workingCopyId() })
    expect(show('author.name() ++ " " ++ author.email()')).toBe('Ukemi Test test@ukemi.dev')
  })

  test('leaves the author when the input is cancelled', async () => {
    await commands()['ukemi.commit.setAuthor']?.({ commitId: workingCopyId() })
    expect(show('author.name()')).toBe('Ukemi Test')
  })

  test('moves the author date to now', async () => {
    jj(root, 'metaedit', '--author-timestamp', '2001-02-03T04:05:06+00:00')
    await model.refresh()

    await commands()['ukemi.commit.updateAuthorDate']?.({ commitId: workingCopyId() })

    expect(show('author.timestamp().utc().format("%Y")')).not.toBe('2001')
  })

  test('gives the change a new change id and keeps its content', async () => {
    const before = show('change_id')
    await commands()['ukemi.commit.newChangeId']?.({ commitId: workingCopyId() })
    expect(show('change_id')).not.toBe(before)
    expect(show('description')).toBe('work\n')
    expect(jj(root, 'file', 'show', '-r', '@', 'f.txt')).toBe('f\n')
  })
})

describe('fix', () => {
  const UPPER_CASE =
    "process.stdin.on('data', (d) => process.stdout.write(d.toString().toUpperCase()))"

  function setup(): void {
    writeFile(root, 'a.txt', 'parent\n')
    jj(root, 'commit', '-m', 'parent')
    writeFile(root, 'a.txt', 'parent\nchild\n')
    jj(root, 'describe', '-m', 'child')
  }

  test('runs the tools on the change and its descendants', async () => {
    jj(
      root,
      'config',
      'set',
      '--repo',
      'fix.tools.upper.command',
      JSON.stringify([process.execPath, '-e', UPPER_CASE]),
    )
    jj(root, 'config', 'set', '--repo', 'fix.tools.upper.patterns', '["glob:*.txt"]')
    setup()
    await model.refresh()
    const parent = model.graph?.commits.find((c) => c.description === 'parent\n')

    await commands()['ukemi.commit.fix']?.({ commitId: parent?.commitId })

    expect(warnings).toEqual([])
    expect(infos).toEqual(['Ukemi: Fixed 2 commits of 2 checked.'])
    expect(jj(root, 'file', 'show', '-r', '@-', 'a.txt')).toBe('PARENT\n')
    expect(jj(root, 'file', 'show', '-r', '@', 'a.txt')).toBe('PARENT\nCHILD\n')
  })

  test('warns when no tools are configured', async () => {
    setup()
    await model.refresh()
    const child = model.graph?.commits.find((c) => c.isWorkingCopy)

    await commands()['ukemi.commit.fix']?.({ commitId: child?.commitId })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('no fix tools')
    expect(jj(root, 'file', 'show', '-r', '@', 'a.txt')).toBe('parent\nchild\n')
  })
})
