import { expect, test } from 'vitest'
import type { HostMessage } from '../../shared/protocol'
import type { CommandEnv } from '../../src/app/commands/context'
import { createMessageHandler } from '../../src/app/messages'
import { NULL_LOGGER } from '../../src/util/logger'

function handlerWith(filesFor: (commitId: string) => Promise<unknown>) {
  const posted: HostMessage[] = []
  const env = {
    registry: { activeModel: { root: '/repo', graph: null, filesFor } },
    graphView: { post: (message: HostMessage) => posted.push(message) },
    logger: NULL_LOGGER,
  } as unknown as CommandEnv
  return { handle: createMessageHandler(env, async () => {}), posted }
}

test('answers loadFiles with the files', async () => {
  const { handle, posted } = handlerWith(async () => [])
  await handle({ type: 'loadFiles', commitId: 'c1' })
  expect(posted).toEqual([{ type: 'files', repoId: '/repo', commitId: 'c1', files: [] }])
})

test('answers loadFiles when jj fails, so the graph does not wait forever', async () => {
  const { handle, posted } = handlerWith(async () => {
    throw new Error('jj timed out')
  })
  await handle({ type: 'loadFiles', commitId: 'c1' })
  expect(posted).toEqual([
    { type: 'filesFailed', repoId: '/repo', commitId: 'c1', error: 'jj timed out' },
  ])
})
