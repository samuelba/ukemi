import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { CommandEnv } from '../../src/app/commands/context'
import { operationCommands } from '../../src/app/commands/operationCommands'
import { Operations } from '../../src/app/operations'
import { operationNodes, type OperationNode } from '../../src/repo/operationItems'
import { RepoModel } from '../../src/repo/repoModel'
import { NULL_LOGGER } from '../../src/util/logger'
import { initRepo, jj, makeRepo, makeTempDir, writeFile, type Fixture } from '../helpers/jjFixture'

let fixture: Fixture
let root: string
let model: RepoModel
let answers: (string | undefined)[]
let asked: string[]
let infos: string[]

beforeEach(() => {
  fixture = makeTempDir()
  root = join(fixture.dir, 'repo')
  initRepo(root)
  writeFile(root, 'a.txt', 'a\n')
  jj(root, 'describe', '-m', 'first')
  jj(root, 'new', '-m', 'second')
  jj(root, 'describe', '-m', 'renamed')
  model = new RepoModel(makeRepo(root), NULL_LOGGER)
  answers = []
  asked = []
  infos = []
})

afterEach(() => fixture.cleanup())

async function run(command: string, arg: unknown): Promise<void> {
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
  await operationCommands(env)[command]?.(arg)
}

function description(): string {
  return jj(root, 'log', '--no-graph', '-r', '@', '-T', 'description').trim()
}

async function nodes(): Promise<OperationNode[]> {
  await model.refresh()
  return operationNodes(root, model.operations, Date.now())
}

function byLabel(list: OperationNode[], prefix: string): OperationNode {
  const node = list.find((entry) => entry.label.startsWith(prefix))
  if (!node) {
    throw new Error(`no operation ${prefix} in ${list.map((entry) => entry.label).join(', ')}`)
  }
  return node
}

describe('operation log', () => {
  test('the model lists operations newest first, with the user', async () => {
    const list = await nodes()

    expect(list[0]?.contextValue).toBe('operation+current')
    expect(list[0]?.label).toMatch(/^describe commit/)
    expect(model.operations[0]?.user).not.toBe('')
  })

  test('restore sets the repository back to an earlier operation', async () => {
    const target = byLabel(await nodes(), 'new empty commit')
    answers.push('Restore')

    await run('ukemi.operation.restore', target)

    expect(asked).toHaveLength(1)
    expect(description()).toBe('second')
  })

  test('revert undoes one operation and keeps the later ones', async () => {
    jj(root, 'new', '-m', 'third')
    const target = byLabel(await nodes(), 'describe commit')
    answers.push('Revert')

    await run('ukemi.operation.revert', target)

    expect(description()).toBe('third')
    expect(jj(root, 'log', '--no-graph', '-r', '@-', '-T', 'description').trim()).toBe('second')
  })

  test('does nothing when the question is dismissed', async () => {
    const target = byLabel(await nodes(), 'new empty commit')

    await run('ukemi.operation.restore', target)

    expect(asked).toHaveLength(1)
    expect(description()).toBe('renamed')
  })

  test('refuses the current operation without asking', async () => {
    const [current] = await nodes()

    await run('ukemi.operation.restore', current)

    expect(asked).toEqual([])
    expect(infos).toHaveLength(1)
  })
})
