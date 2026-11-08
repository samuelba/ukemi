import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { RequestBadge } from '../../shared/protocol'
import type { CommandEnv, Handler } from '../../src/app/commands/context'
import { bookmarkCommands } from '../../src/app/commands/bookmarkCommands'
import { requestCommands } from '../../src/app/commands/requestCommands'
import { Operations } from '../../src/app/operations'
import type { MergeMethod } from '../../src/forge/types'
import { RepoModel } from '../../src/repo/repoModel'
import { NULL_LOGGER } from '../../src/util/logger'
import { initRepo, jj, makeRepo, makeTempDir, type Fixture } from '../helpers/jjFixture'

let fixture: Fixture
let root: string
let model: RepoModel
let operations: Operations
let merged: number[]

const REQUEST: RequestBadge = {
  number: 7,
  title: 'Feature',
  url: 'https://github.com/o/r/pull/7',
  state: 'open',
  ci: 'none',
  isMine: true,
  checks: [],
  headBranch: 'feature',
  baseBranch: 'main',
}

beforeEach(async () => {
  fixture = makeTempDir()
  root = join(fixture.dir, 'repo')
  initRepo(root)
  jj(root, 'describe', '-m', 'feature')
  jj(root, 'bookmark', 'set', 'feature', '-r', '@')
  model = new RepoModel(makeRepo(root), NULL_LOGGER)
  await model.refresh()
  model.setForge({ kind: 'github', host: 'github.com', isSignedIn: true }, [REQUEST])
  operations = new Operations(NULL_LOGGER)
  merged = []
})

afterEach(() => fixture.cleanup())

function commands(): Record<string, Handler> {
  const client = {
    kind: 'github',
    mergeRequest: async (number: number, _method: MergeMethod) => {
      merged.push(number)
      return 'merged'
    },
  }
  const env = {
    registry: { modelFor: () => model, activeModel: model },
    operations,
    logger: NULL_LOGGER,
    forge: { client: async () => client, refreshRequests: async () => undefined },
    ui: {
      pick: async (items: readonly { label: string }[]) => items[0],
      info: async () => undefined,
      warn: async () => undefined,
    },
  } as unknown as CommandEnv
  return { ...bookmarkCommands(env), ...requestCommands(env) }
}

describe('ship request', () => {
  test('a failed fetch after the merge does not report a failed ship', async () => {
    await commands()['ukemi.request.merge']?.({ number: REQUEST.number })

    expect(merged).toEqual([REQUEST.number])
    expect(operations.error).toMatch(/^Fetch failed/)
  })
})
