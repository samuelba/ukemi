import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { commitCommands } from '../../src/app/commands/commitCommands'
import { bookmarkPointsElsewhere } from '../../src/app/commands/refCommands'
import type { CommandEnv } from '../../src/app/commands/context'
import { Operations } from '../../src/app/operations'
import { RepoModel } from '../../src/repo/repoModel'
import { NULL_LOGGER } from '../../src/util/logger'
import { initRepo, jj, makeRepo, makeTempDir, writeFile, type Fixture } from '../helpers/jjFixture'

let fixture: Fixture
let root: string
let model: RepoModel
let warnings: string[]

beforeEach(() => {
  fixture = makeTempDir()
  root = join(fixture.dir, 'repo')
  initRepo(root)
  model = new RepoModel(makeRepo(root), NULL_LOGGER, { filter: 'mine' })
  warnings = []
})

afterEach(() => fixture.cleanup())

function commands(): ReturnType<typeof commitCommands> {
  const env = {
    registry: { modelFor: () => model, activeModel: model },
    operations: new Operations(NULL_LOGGER),
    logger: NULL_LOGGER,
    ui: {
      warn: async (text: string) => {
        warnings.push(text)
        return undefined
      },
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
