import { describe, expect, test, vi } from 'vitest'
import { Emitter } from '../../src/app/events'
import {
  readSettings,
  updateWhereItLives,
  type Settings,
  type SettingsChange,
} from '../../src/app/settings'
import { isRepositoryKey } from '../../shared/settingsScope'

function fakeSettings(repoValue: unknown): Settings {
  return {
    read: () => readSettings({ get: (_key, fallback) => fallback }),
    inspect: () => ({ globalValue: undefined, repoValue }),
    update: vi.fn(async () => undefined),
    onDidChange: new Emitter<SettingsChange>().event,
  }
}

describe('isRepositoryKey', () => {
  test('knows the settings a repository can override', () => {
    expect(isRepositoryKey('autoFetch.enabled')).toBe(true)
    expect(isRepositoryKey('changeIdLength')).toBe(false)
    expect(isRepositoryKey('repositories')).toBe(false)
  })
})

describe('updateWhereItLives', () => {
  test('writes the repository value when the repository overrides it', async () => {
    const settings = fakeSettings(false)
    await updateWhereItLives(settings, 'showGitTags', true, '/repo')
    expect(settings.update).toHaveBeenCalledWith('showGitTags', true, { root: '/repo' })
  })

  test('writes the global value otherwise', async () => {
    const settings = fakeSettings(undefined)
    await updateWhereItLives(settings, 'showGitTags', true, '/repo')
    expect(settings.update).toHaveBeenCalledWith('showGitTags', true, 'default')
    await updateWhereItLives(settings, 'showGitTags', false, null)
    expect(settings.update).toHaveBeenLastCalledWith('showGitTags', false, 'default')
  })
})
