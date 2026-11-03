import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { CommandEnv } from '../../src/app/commands/context'
import { globalCommands } from '../../src/app/commands/globalCommands'
import { Operations } from '../../src/app/operations'
import { RepoModel } from '../../src/repo/repoModel'
import { NULL_LOGGER } from '../../src/util/logger'
import { initRepo, jj, makeRepo, makeTempDir, writeFile, type Fixture } from '../helpers/jjFixture'

let fixture: Fixture
let root: string
let remote: string
let model: RepoModel
let answers: (string | undefined)[]
let asked: string[]
let infos: string[]

beforeEach(() => {
  fixture = makeTempDir()
  root = join(fixture.dir, 'repo')
  remote = join(fixture.dir, 'remote.git')
  initRepo(root)
  execFileSync('git', ['init', '--bare', '-q', remote])
  jj(root, 'git', 'remote', 'add', 'origin', remote)
  writeFile(root, 'a.txt', 'a\n')
  jj(root, 'describe', '-m', 'first')
  jj(root, 'bookmark', 'set', 'shared', '-r', '@')
  jj(root, 'git', 'push', '--bookmark', 'shared')
  jj(root, 'new', '-m', 'second')
  writeFile(root, 'b.txt', 'b\n')
  jj(root, 'bookmark', 'set', 'shared', '-r', '@')
  jj(root, 'bookmark', 'set', 'wip', '-r', '@')
  model = new RepoModel(makeRepo(root), NULL_LOGGER)
  answers = []
  asked = []
  infos = []
})

afterEach(() => fixture.cleanup())

async function run(command: string): Promise<void> {
  const env = {
    registry: { modelFor: () => model, activeModel: model },
    operations: new Operations(NULL_LOGGER),
    logger: NULL_LOGGER,
    ui: {
      ask: async (_level: string, text: string) => {
        asked.push(text)
        return answers.shift()
      },
      info: async (text: string) => {
        infos.push(text)
        return undefined
      },
      warn: async () => undefined,
    },
  } as unknown as CommandEnv
  await globalCommands(env)[command]?.()
}

function remoteBranches(): string[] {
  return execFileSync('git', ['ls-remote', '--heads', remote], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^.*refs\/heads\//, ''))
}

describe('push all', () => {
  test('asks before it publishes a bookmark no remote has', async () => {
    answers.push('Only Published Ones')
    await run('ukemi.push')

    expect(asked).toEqual(['Also push 1 bookmark that no remote has yet?'])
    expect(remoteBranches()).toEqual(['shared'])
  })

  test('pushes the new bookmarks when the user agrees', async () => {
    answers.push('Push All')
    await run('ukemi.push')

    expect(remoteBranches().sort()).toEqual(['shared', 'wip'])
  })

  test('pushes nothing when the question is dismissed', async () => {
    const before = execFileSync('git', ['ls-remote', remote], { encoding: 'utf8' })
    await run('ukemi.push')

    expect(execFileSync('git', ['ls-remote', remote], { encoding: 'utf8' })).toBe(before)
  })
})

describe('undo', () => {
  function head(): string {
    return jj(root, 'op', 'log', '--no-graph', '--limit=1', '-T', 'description')
  }

  test('does not undo a push', async () => {
    jj(root, 'git', 'push', '--bookmark', 'shared')
    const before = head()
    await model.refresh()

    await run('ukemi.undo')

    expect(head()).toBe(before)
    expect(infos).toHaveLength(1)
  })

  test('undoes a local operation', async () => {
    await model.refresh()

    await run('ukemi.undo')

    expect(head()).toMatch(/^undo/)
    expect(infos).toEqual([])
  })
})
