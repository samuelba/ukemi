import { describe, expect, test } from 'vitest'
import {
  isValidSettingValue,
  runsProgram,
  settingFields,
  settingTitle,
} from '../../src/desktop/settingsSchema'

describe('settingFields', () => {
  const fields = settingFields({ 'autoFetch.enabled': true, 'gitlab.hosts': ['git.example.com'] })
  const field = (key: string) => fields.find((f) => f.key === key)

  test('leaves out the settings only an editor uses', () => {
    for (const key of [
      'showInPanel',
      'showSourceControl',
      'followActiveEditor',
      'addJjToTerminalPath',
    ]) {
      expect(field(key), key).toBeUndefined()
    }
  })

  test('maps each schema type to a form field', () => {
    expect(field('autoFetch.enabled')).toMatchObject({
      type: 'boolean',
      value: true,
      default: false,
    })
    expect(field('changedFilesView')).toMatchObject({
      type: 'enum',
      options: [
        { value: 'list', description: expect.any(String) },
        { value: 'tree', description: expect.any(String) },
      ],
    })
    expect(field('changeIdLength')).toMatchObject({ type: 'number', minimum: expect.any(Number) })
    expect(field('gitlab.hosts')).toMatchObject({ type: 'list', value: ['git.example.com'] })
    expect(field('gitlab.oauthApplications')).toMatchObject({ type: 'map', default: {} })
    expect(field('autoFetch.interval')).toMatchObject({
      type: 'string',
      pattern: expect.any(String),
    })
  })

  test('groups the fields and keeps package.json order inside a group', () => {
    expect([...new Set(fields.map((f) => f.group))]).toEqual([
      'General',
      'Fonts',
      'Keyboard Shortcuts',
      'Graph',
      'Descriptions',
      'Workspaces',
      'Fetching',
      'GitHub and GitLab',
    ])
    const graph = fields.filter((f) => f.group === 'Graph').map((f) => f.key)
    expect(graph.indexOf('defaultFilter')).toBeLessThan(graph.indexOf('changedFilesView'))
  })

  test('lists every menu command with its default keys in the shortcuts field', () => {
    const shortcuts = fields.find((f) => f.key === 'desktop.keybindings')
    expect(shortcuts).toMatchObject({ type: 'shortcuts', group: 'Keyboard Shortcuts' })
    expect(shortcuts?.shortcuts).toContainEqual({
      id: 'ukemi.fetch',
      menu: 'Repository',
      title: 'Fetch',
      default: 'CmdOrCtrl+Shift+F',
    })
  })

  test('offers the settings of the standalone app first', () => {
    expect(fields[0]).toMatchObject({
      key: 'desktop.restoreRepositories',
      type: 'boolean',
      default: true,
      value: undefined,
    })
  })

  test('offers a theme choice', () => {
    expect(field('desktop.theme')).toMatchObject({
      type: 'enum',
      default: 'system',
      options: [{ value: 'system' }, { value: 'light' }, { value: 'dark' }],
    })
  })

  test('marks the fields a repository can override, and where they are overridden', () => {
    const scoped = settingFields({}, (key) => (key === 'historyDepth' ? ['big-mono'] : []))
    const depth = scoped.find((f) => f.key === 'historyDepth')
    expect(depth).toMatchObject({ isRepositoryScoped: true, overriddenIn: ['big-mono'] })
    expect(scoped.find((f) => f.key === 'changeIdLength')).toMatchObject({
      isRepositoryScoped: false,
      overriddenIn: [],
    })
    expect(scoped.filter((f) => f.isRepositoryScoped)).toHaveLength(14)
  })

  test('marks unset values as undefined', () => {
    expect(field('jjPath')?.value).toBeUndefined()
    expect(fields.every((f) => f.description.length > 0)).toBe(true)
  })
})

test('settingTitle reads like the VS Code settings editor', () => {
  expect(settingTitle('autoFetch.enabled')).toBe('Auto Fetch: Enabled')
  expect(settingTitle('repoScanDepth')).toBe('Repo Scan Depth')
  expect(settingTitle('gitlab.oauthApplications')).toBe('Gitlab: Oauth Applications')
})

describe('isValidSettingValue', () => {
  const fields = settingFields({})
  const valid = (key: string, value: unknown) => {
    const field = fields.find((f) => f.key === key)
    if (!field) {
      throw new Error(`no field ${key}`)
    }
    return isValidSettingValue(field, value)
  }

  test('accepts values of the field type, and a reset', () => {
    expect(valid('showGitTags', false)).toBe(true)
    expect(valid('historyDepth', '30d')).toBe(true)
    expect(valid('changeIdLength', 8)).toBe(true)
    expect(valid('repoScanExclude', ['node_modules'])).toBe(true)
    expect(valid('describeSuggest.models', { claude: 'haiku' })).toBe(true)
    expect(valid('showGitTags', undefined)).toBe(true)
  })

  test('rejects values of another type, outside the options or the range', () => {
    expect(valid('showGitTags', 'yes')).toBe(false)
    expect(valid('historyDepth', 'forever')).toBe(false)
    expect(valid('changeIdLength', Number.NaN)).toBe(false)
    expect(valid('changeIdLength', 10_000)).toBe(false)
    expect(valid('repoScanExclude', ['ok', 3])).toBe(false)
    expect(valid('describeSuggest.models', { claude: { nested: true } })).toBe(false)
    expect(valid('describeSuggest.models', ['haiku'])).toBe(false)
  })
})

describe('runsProgram', () => {
  test('names the settings that pick a program to run', () => {
    expect(runsProgram('jjPath')).toBe(true)
    expect(runsProgram('showGitTags')).toBe(false)
  })
})
