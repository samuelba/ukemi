import { describe, expect, test, vi } from 'vitest'
import { affectsJj, applyRepositorySettings } from '../../src/app/settingsEffects'

const change = (...keys: string[]) => ({ affects: (key: string) => keys.includes(key) })

function registry() {
  return {
    discover: vi.fn(async () => undefined),
    applyWorkspaceSettings: vi.fn(),
    applyLineStats: vi.fn(async () => undefined),
  }
}

describe('applyRepositorySettings', () => {
  test('reloads the line stats when they are switched on or off', async () => {
    const repos = registry()
    await applyRepositorySettings(change('showLineStats'), repos as never)
    expect(repos.applyLineStats).toHaveBeenCalledOnce()
    expect(repos.discover).not.toHaveBeenCalled()
  })

  test('rediscovers repositories when the scan changes', async () => {
    const repos = registry()
    await applyRepositorySettings(change('repoScanExclude'), repos as never)
    expect(repos.discover).toHaveBeenCalledOnce()
  })

  test('applies the workspace snapshot setting', async () => {
    const repos = registry()
    await applyRepositorySettings(change('workspaces.snapshotOnRefresh'), repos as never)
    expect(repos.applyWorkspaceSettings).toHaveBeenCalledOnce()
  })

  test('leaves the other settings to the views', async () => {
    const repos = registry()
    await applyRepositorySettings(change('showGitTags'), repos as never)
    expect(Object.values(repos).every((fn) => fn.mock.calls.length === 0)).toBe(true)
  })
})

test('affectsJj names the settings that pick the jj binary', () => {
  expect(affectsJj(change('jjPath'))).toBe(true)
  expect(affectsJj(change('showLineStats'))).toBe(false)
  expect(affectsJj(change('addJjToTerminalPath'), ['jjPath', 'addJjToTerminalPath'])).toBe(true)
})
