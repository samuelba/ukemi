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

describe('jj log filter', () => {
  test('shows revsets.log from the repository config, with the working copy', async () => {
    jj(root, 'config', 'set', '--repo', 'revsets.log', 'description(substring:"first")')

    await model.setView('jjLog', '7d')

    expect(model.graph?.filter).toBe('jjLog')
    expect(model.graph?.logRevset).toBe('description(substring:"first")')
    expect(descriptions()).toEqual(['third', 'first'])
  })

  test('reads the config again on each refresh', async () => {
    jj(root, 'config', 'set', '--repo', 'revsets.log', 'description(substring:"first")')
    await model.setView('jjLog', '7d')
    jj(root, 'config', 'set', '--repo', 'revsets.log', 'description(substring:"second")')

    await model.refresh()

    expect(descriptions()).toEqual(['third', 'second'])
  })

  test('shows the recent changes when revsets.log is empty', async () => {
    jj(root, 'config', 'set', '--repo', 'revsets.log', '')

    await model.setView('jjLog', '7d')

    expect(model.graph?.logRevset).toBeUndefined()
    expect(descriptions()).toEqual(['third', 'second', 'first'])
  })
})

describe('saved revsets', () => {
  interface SaveEnv {
    input?: string
    replace?: boolean
    failUpdate?: boolean
    repoValue?: unknown
    globalValue?: unknown
  }

  function saveHandler(options: SaveEnv) {
    const calls = {
      inputs: [] as unknown[],
      asks: [] as string[],
      updates: [] as unknown[][],
      opened: [] as (string | undefined)[],
      errors: [] as string[],
    }
    const env = {
      registry: { activeModel: model },
      ui: {
        input: async (input: unknown) => {
          calls.inputs.push(input)
          return options.input
        },
        ask: async (_kind: string, message: string, _detail: unknown, action: string) => {
          calls.asks.push(message)
          return options.replace ? action : undefined
        },
        error: async (text: string) => {
          calls.errors.push(text)
          return undefined
        },
      },
      settings: {
        inspect: () => ({ globalValue: options.globalValue, repoValue: options.repoValue }),
        update: async (...args: unknown[]) => {
          if (options.failUpdate) {
            throw new Error('settings.json is read-only')
          }
          calls.updates.push(args)
        },
      },
      workbench: { openSettings: (key?: string) => calls.opened.push(key) },
      operations: new Operations(NULL_LOGGER),
      graphView: { post: (message: HostMessage) => posted.push(message) },
      logger: NULL_LOGGER,
    } as unknown as CommandEnv
    return { handle: createMessageHandler(env, async () => {}), calls }
  }

  test('saves the revset under the name the user gives, next to the saved ones', async () => {
    const { handle, calls } = saveHandler({ input: ' First ', globalValue: { Mine: 'mine()' } })

    await handle({ type: 'saveRevset', revset: ' description(substring:"first") ' })

    expect(calls.inputs).toEqual([
      expect.objectContaining({ value: 'description(substring:"first")' }),
    ])
    expect(calls.updates).toEqual([
      ['savedRevsets', { Mine: 'mine()', First: 'description(substring:"first")' }, 'default'],
    ])
  })

  test('saves into the repository list when the repository has its own', async () => {
    const { handle, calls } = saveHandler({ input: 'All', repoValue: {}, globalValue: { A: 'a' } })

    await handle({ type: 'saveRevset', revset: 'all()' })

    expect(calls.updates).toEqual([['savedRevsets', { All: 'all()' }, { root }]])
  })

  test('asks before it replaces a saved revset of the same name', async () => {
    const declined = saveHandler({ input: 'Mine', globalValue: { Mine: 'mine()' } })
    await declined.handle({ type: 'saveRevset', revset: 'all()' })
    expect(declined.calls.asks).toHaveLength(1)
    expect(declined.calls.updates).toEqual([])

    const accepted = saveHandler({ input: 'Mine', replace: true, globalValue: { Mine: 'mine()' } })
    await accepted.handle({ type: 'saveRevset', revset: 'all()' })
    expect(accepted.calls.updates).toEqual([['savedRevsets', { Mine: 'all()' }, 'default']])
  })

  test('says so when the setting cannot be written', async () => {
    const { handle, calls } = saveHandler({ input: 'All', failUpdate: true })

    await handle({ type: 'saveRevset', revset: 'all()' })

    expect(calls.errors).toEqual([expect.stringContaining('settings.json is read-only')])
  })

  test('saves nothing when the user cancels', async () => {
    const { handle, calls } = saveHandler({ input: undefined })

    await handle({ type: 'saveRevset', revset: 'all()' })

    expect(calls.updates).toEqual([])
  })

  test('opens the setting to edit the saved revsets', async () => {
    const { handle, calls } = saveHandler({})

    await handle({ type: 'editSavedRevsets' })

    expect(calls.opened).toEqual(['ukemi.savedRevsets'])
  })
})
