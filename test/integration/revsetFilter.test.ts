import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { HostMessage } from '../../shared/protocol'
import type { CommandEnv } from '../../src/app/commands/context'
import type { KeyValueStore } from '../../src/app/host'
import { createMessageHandler } from '../../src/app/messages'
import { Operations } from '../../src/app/operations'
import {
  readRevsetHistory,
  readView,
  rememberRevset,
  rememberView,
  type GraphView,
} from '../../src/app/rememberedView'
import { RepoModel } from '../../src/repo/repoModel'
import { NULL_LOGGER } from '../../src/util/logger'
import { initRepo, jj, makeRepo, makeTempDir, writeFile, type Fixture } from '../helpers/jjFixture'

const DEFAULTS: GraphView = { filter: 'recent', depth: '7d' }

let fixture: Fixture
let root: string
let model: RepoModel
let posted: HostMessage[]
let store: KeyValueStore

function memoryStore(): KeyValueStore {
  const values = new Map<string, unknown>()
  return {
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: async (key, value) => {
      values.set(key, value)
    },
  }
}

beforeEach(async () => {
  fixture = makeTempDir()
  root = join(fixture.dir, 'repo')
  initRepo(root)
  writeFile(root, 'a.txt', 'a\n')
  jj(root, 'describe', '-m', 'first')
  jj(root, 'new', '-m', 'second')
  jj(root, 'new', '-m', 'third')
  model = new RepoModel(makeRepo(root), NULL_LOGGER, { filter: 'working' })
  await model.refresh()
  posted = []
  store = memoryStore()
})

afterEach(() => fixture.cleanup())

function handler() {
  const env = {
    registry: {
      activeModel: model,
      rememberView: (repo: string, view: GraphView) => rememberView(store, repo, view, DEFAULTS),
      revsetHistory: (repo: string) => readRevsetHistory(store, repo),
      rememberRevset: (repo: string, revset: string) => rememberRevset(store, repo, revset),
    },
    operations: new Operations(NULL_LOGGER),
    graphView: { post: (message: HostMessage) => posted.push(message) },
    logger: NULL_LOGGER,
  } as unknown as CommandEnv
  return createMessageHandler(env, async () => {})
}

function descriptions(): string[] {
  return (model.graph?.commits ?? []).map((commit) => commit.description.trim())
}

describe('custom revset', () => {
  test('shows the revset with the working copy, and remembers it', async () => {
    await handler()({ type: 'setRevset', revset: ' description(substring:"first") ' })

    expect(posted[0]).toEqual({
      type: 'revsetResult',
      revset: 'description(substring:"first")',
      error: null,
    })
    expect(model.graph?.revset).toBe('description(substring:"first")')
    expect(descriptions()).toEqual(['third', 'first'])
    expect(readView(store, root, DEFAULTS)?.revset).toBe('description(substring:"first")')
    expect(readRevsetHistory(store, root)).toEqual(['description(substring:"first")'])
  })

  test('a revset jj cannot read reports the error and keeps the graph', async () => {
    const before = descriptions()

    await handler()({ type: 'setRevset', revset: 'nosuchbookmark | (' })

    const [reply] = posted
    expect(reply?.type).toBe('revsetResult')
    expect(reply?.type === 'revsetResult' && reply.error).toMatch(/parse revset/i)
    expect(model.graph?.revset).toBeNull()
    expect(descriptions()).toEqual(before)
    expect(readView(store, root, DEFAULTS)).toBeNull()
    expect(readRevsetHistory(store, root)).toEqual([])
  })

  test('an empty revset goes back to the filter', async () => {
    await handler()({ type: 'setRevset', revset: 'all()' })
    await handler()({ type: 'setRevset', revset: '' })

    expect(model.graph?.revset).toBeNull()
    expect(model.graph?.filter).toBe('working')
    expect(readView(store, root, DEFAULTS)?.revset).toBeUndefined()
  })

  test('picking a filter replaces the revset', async () => {
    await handler()({ type: 'setRevset', revset: 'all()' })
    await handler()({ type: 'setFilter', filter: 'stack' })

    expect(model.graph?.revset).toBeNull()
    expect(model.graph?.filter).toBe('stack')
  })
})
