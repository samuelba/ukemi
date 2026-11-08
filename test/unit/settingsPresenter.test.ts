import { describe, expect, test } from 'vitest'
import type { ShellInbound } from '../../shared/desktopProtocol'
import { SettingsPresenter, type PresentedSettings } from '../../src/desktop/settingsPresenter'
import { NULL_LOGGER } from '../../src/util/logger'

interface Update {
  key: string
  value: unknown
  scope?: unknown
}

function setup(options: { confirm?: boolean } = {}) {
  const updates: Update[] = []
  const posted: ShellInbound[] = []
  const asked: string[] = []
  let activeRoot: string | null = '/repo'
  const settings = {
    path: '/config/settings.json',
    values: () => ({}),
    overrides: () => new Map([['/repo', { showGitTags: false }]]),
    update: async (key: string, value: unknown, scope?: unknown) => {
      updates.push({ key, value, ...(scope ? { scope } : {}) })
    },
  } as unknown as PresentedSettings
  const presenter = new SettingsPresenter({
    settings,
    repos: () => [{ id: '/repo', label: 'repo' }],
    activeRoot: () => activeRoot,
    post: (message) => posted.push(message),
    confirm: async (text) => {
      asked.push(text)
      return options.confirm ?? true
    },
    logger: NULL_LOGGER,
  })
  return {
    presenter,
    updates,
    posted,
    asked,
    activate: (root: string | null) => (activeRoot = root),
  }
}

describe('SettingsPresenter.set', () => {
  test('writes a valid global value', async () => {
    const { presenter, updates } = setup()
    await presenter.set('changeIdLength', 6, undefined)
    expect(updates).toEqual([{ key: 'changeIdLength', value: 6 }])
  })

  test('ignores unknown keys and invalid values, and shows the form again', async () => {
    const { presenter, updates, posted } = setup()
    await presenter.set('notASetting', 1, undefined)
    await presenter.set('changeIdLength', 'six', undefined)
    expect(updates).toEqual([])
    expect(posted.filter((m) => m.type === 'desktop.settings')).toHaveLength(1)
  })

  test('writes an override only for an open repository and a repository key', async () => {
    const { presenter, updates } = setup()
    await presenter.set('showGitTags', false, '/repo')
    await presenter.set('showGitTags', false, '/elsewhere')
    await presenter.set('changeIdLength', 6, '/repo')
    expect(updates).toEqual([{ key: 'showGitTags', value: false, scope: { root: '/repo' } }])
  })

  test('asks before running another jj, and keeps the old one on no', async () => {
    const declined = setup({ confirm: false })
    await declined.presenter.set('jjPath', '/tmp/jj', undefined)
    expect(declined.asked).toEqual(['Run jj from /tmp/jj?'])
    expect(declined.updates).toEqual([])

    const accepted = setup({ confirm: true })
    await accepted.presenter.set('jjPath', '/tmp/jj', undefined)
    expect(accepted.updates).toEqual([{ key: 'jjPath', value: '/tmp/jj' }])
  })

  test('clearing the jj path needs no confirm', async () => {
    const { presenter, asked, updates } = setup({ confirm: false })
    await presenter.set('jjPath', '', undefined)
    expect(asked).toEqual([])
    expect(updates).toEqual([{ key: 'jjPath', value: '' }])
  })
})

describe('SettingsPresenter.post', () => {
  test('names the repositories that override a key, and shows the active one', () => {
    const { presenter, posted } = setup()
    presenter.post()
    const message = posted[0]
    expect(message?.type).toBe('desktop.settings')
    if (message?.type !== 'desktop.settings') {
      return
    }
    expect(message.fields.find((f) => f.key === 'showGitTags')?.overriddenIn).toEqual(['repo'])
    expect(message.repository).toEqual({ id: '/repo', label: 'repo', values: {} })
  })

  test('follows the active repository only when it changed', () => {
    const { presenter, posted, activate } = setup()
    presenter.post()
    presenter.followActiveRepo()
    expect(posted).toHaveLength(1)
    activate(null)
    presenter.followActiveRepo()
    expect(posted).toHaveLength(2)
  })
})
