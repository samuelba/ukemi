import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { CommandEnv } from '../../src/app/commands/context'
import { commitCommands } from '../../src/app/commands/commitCommands'
import { globalCommands } from '../../src/app/commands/globalCommands'
import { Operations } from '../../src/app/operations'
import { RepoModel } from '../../src/repo/repoModel'
import { NULL_LOGGER } from '../../src/util/logger'
import { initRepo, jj, makeRepo, makeTempDir, writeFile, type Fixture } from '../helpers/jjFixture'

let fixture: Fixture
let root: string
let model: RepoModel
let answers: (string | undefined)[]
let asked: string[]
let infos: string[]

function change(message: string, file: string, from: string): void {
  jj(root, 'new', from, '-m', message)
  writeFile(root, file, `${message}\n`)
}

// Two stacks of mine and one by someone else, all on a trunk that then moves on.
beforeEach(() => {
  fixture = makeTempDir()
  root = join(fixture.dir, 'repo')
  const remote = join(fixture.dir, 'remote.git')
  initRepo(root)
  execFileSync('git', ['init', '--bare', '-q', remote])
  jj(root, 'git', 'remote', 'add', 'origin', remote)
  writeFile(root, 'base.txt', 'base\n')
  jj(root, 'describe', '-m', 'base')
  jj(root, 'bookmark', 'set', 'main', '-r', '@')
  jj(root, 'git', 'push', '--bookmark', 'main')
  change('a1', 'a1.txt', 'main')
  change('a2', 'a2.txt', '@')
  change('b1', 'b1.txt', 'main')
  change('c1', 'c1.txt', 'main')
  jj(root, 'metaedit', '--author', 'Someone Else <else@ukemi.dev>')
  change('m2', 'm2.txt', 'main')
  jj(root, 'bookmark', 'set', 'main', '-r', '@')
  jj(root, 'new')
  jj(root, 'git', 'push', '--bookmark', 'main')
  model = new RepoModel(makeRepo(root), NULL_LOGGER)
  answers = []
  asked = []
  infos = []
})

afterEach(() => fixture.cleanup())

function env(): CommandEnv {
  return {
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
}

function behind(): string[] {
  return (model.graph?.commits ?? [])
    .filter((c) => c.isBehindTrunk)
    .map((c) => c.description.trim())
    .sort()
}

function parentOf(message: string): string {
  return jj(
    root,
    'log',
    '--no-graph',
    '-r',
    `description(exact:"${message}\n")-`,
    '-T',
    'description',
  ).trim()
}

describe('stale stack heads', () => {
  test('marks the newest change of each stack that is not on the trunk', async () => {
    await model.refresh()

    expect(model.graph?.trunkName).toBe('main')
    expect(behind()).toEqual(['a2', 'b1', 'c1'])
  })

  test('the hover action rebases the whole stack and clears the mark', async () => {
    await model.refresh()
    const head = model.graph?.commits.find((c) => c.description.trim() === 'a2')
    await commitCommands(env())['ukemi.commit.rebaseStackTrunk']?.({
      repoId: model.root,
      commitId: head?.commitId,
    })
    await model.refresh()

    expect(parentOf('a1')).toBe('m2')
    expect(parentOf('a2')).toBe('a1')
    expect(behind()).toEqual(['b1', 'c1'])
  })
})

describe('rebase my stacks onto trunk', () => {
  test('asks, then rebases my stacks and leaves the others', async () => {
    await model.refresh()
    answers.push('Rebase')
    await globalCommands(env())['ukemi.rebaseStacksTrunk']?.()
    await model.refresh()

    expect(asked).toEqual(['Rebase 2 stacks onto main?'])
    expect(parentOf('a1')).toBe('m2')
    expect(parentOf('b1')).toBe('m2')
    expect(parentOf('c1')).toBe('base')
    expect(behind()).toEqual(['c1'])
  })

  test('does nothing when the user declines', async () => {
    await model.refresh()
    await globalCommands(env())['ukemi.rebaseStacksTrunk']?.()
    await model.refresh()

    expect(parentOf('a1')).toBe('base')
    expect(behind()).toEqual(['a2', 'b1', 'c1'])
  })

  test('says so when every stack of mine is on the trunk', async () => {
    jj(root, 'rebase', '-b', 'description(exact:"a2\n") | description(exact:"b1\n")', '-d', 'main')
    await model.refresh()
    await globalCommands(env())['ukemi.rebaseStacksTrunk']?.()

    expect(asked).toEqual([])
    expect(infos).toEqual(['Ukemi: all your stacks are already on main.'])
  })
})
