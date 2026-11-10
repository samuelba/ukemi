import { afterEach, describe, expect, test, vi } from 'vitest'
import { AutoFetcher } from '../../src/app/autoFetch'
import { Emitter } from '../../src/app/events'
import type { ForgeService } from '../../src/app/forgeService'
import type { Host } from '../../src/app/host'
import type { Operations } from '../../src/app/operations'
import type { RepoRegistry } from '../../src/app/registry'
import type { RepoModel } from '../../src/repo/repoModel'
import type { Logger } from '../../src/util/logger'

function setup(isTrusted: boolean) {
  const fetch = vi.fn(async () => undefined)
  const model = {
    root: '/repo',
    graph: { hasRemotes: true },
    repo: { fetch, hasPendingMutations: false },
    markDirty: () => undefined,
    refresh: async () => undefined,
  } as unknown as RepoModel
  const trustEmitter = new Emitter<void>()
  const window = { isFocused: true, isTrusted, onDidFocus: new Emitter<void>().event }
  const host = {
    settings: {
      read: () => ({ autoFetchEnabled: true, autoFetchInterval: '10m' }),
      onDidChange: () => ({ dispose: () => undefined }),
    },
    window: { ...window, onDidGrantTrust: trustEmitter.event },
  } as unknown as Pick<Host, 'settings' | 'window'>
  const registry = {
    activeModel: model,
    onDidChange: () => ({ dispose: () => undefined }),
  } as unknown as RepoRegistry
  const operations = {
    busy: false,
    onDidChange: () => ({ dispose: () => undefined }),
  } as unknown as Operations
  const forge = { refreshRequests: async () => undefined } as unknown as ForgeService
  const logger = { warn: () => undefined, error: () => undefined } as unknown as Logger
  return {
    fetch,
    host,
    trustEmitter,
    start: () => new AutoFetcher(registry, forge, operations, logger, host),
  }
}

describe('AutoFetcher', () => {
  let fetcher: AutoFetcher | undefined
  afterEach(() => fetcher?.dispose())

  test('fetches a trusted repository in the background', () => {
    const { fetch, start } = setup(true)
    fetcher = start()
    expect(fetch).toHaveBeenCalledWith({ interactive: false })
  })

  test('does not fetch an untrusted repository, whose git config could run commands', () => {
    const { fetch, start } = setup(false)
    fetcher = start()
    expect(fetch).not.toHaveBeenCalled()
  })

  test('starts fetching once the repository is trusted', () => {
    const { fetch, host, trustEmitter, start } = setup(false)
    fetcher = start()
    Object.assign(host.window, { isTrusted: true })
    trustEmitter.fire()
    expect(fetch).toHaveBeenCalledOnce()
  })
})
