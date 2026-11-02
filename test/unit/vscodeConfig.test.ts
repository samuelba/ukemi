import { beforeEach, describe, expect, test, vi } from 'vitest'

interface Scope {
  global: Record<string, unknown>
  folder: Record<string, unknown>
}

const scopes = new Map<string, Scope>()
const updates: Array<{ resource: string | null; key: string; value: unknown; target: number }> = []
let fireChange: (event: {
  affectsConfiguration(section: string, resource?: { fsPath: string }): boolean
}) => void = () => undefined

vi.mock('vscode', () => {
  const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 }
  return {
    ConfigurationTarget,
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    workspace: {
      getConfiguration: (_section: string, resource?: { fsPath: string }) => {
        const scope = scopes.get(resource?.fsPath ?? '') ?? { global: {}, folder: {} }
        const values = { ...scope.global, ...scope.folder }
        return {
          get: <T>(key: string, fallback: T): T => (key in values ? (values[key] as T) : fallback),
          inspect: (key: string) => ({
            globalValue: scope.global[key],
            workspaceFolderValue: scope.folder[key],
          }),
          update: async (key: string, value: unknown, target: number) => {
            updates.push({ resource: resource?.fsPath ?? null, key, value, target })
          },
        }
      },
      onDidChangeConfiguration: (listener: typeof fireChange) => {
        fireChange = listener
        return { dispose: () => undefined }
      },
    },
  }
})

const { vscodeSettings } = await import('../../src/vscode/config')

beforeEach(() => {
  scopes.clear()
  updates.length = 0
})

describe('vscodeSettings', () => {
  test('reads the settings of a repository from its folder', () => {
    scopes.set('', { global: { showGitTags: true }, folder: {} })
    scopes.set('/repo', { global: { showGitTags: true }, folder: { showGitTags: false } })
    const settings = vscodeSettings()
    expect(settings.read().showGitTags).toBe(true)
    expect(settings.read('/repo').showGitTags).toBe(false)
    expect(settings.inspect('showGitTags', '/repo')).toEqual({
      globalValue: true,
      repoValue: false,
    })
  })

  test('writes a repository override to the folder settings', async () => {
    const settings = vscodeSettings()
    await settings.update('historyDepth', '14d', { root: '/repo' })
    expect(updates).toEqual([{ resource: '/repo', key: 'historyDepth', value: '14d', target: 3 }])
  })

  test('asks VS Code whether a change reaches a repository', () => {
    const settings = vscodeSettings()
    const seen: boolean[] = []
    settings.onDidChange((change) => {
      seen.push(change.affects('showGitTags'), change.affects('showGitTags', '/repo'))
    })
    fireChange({
      affectsConfiguration: (section, resource) =>
        section.startsWith('ukemi') && resource?.fsPath !== '/repo',
    })
    expect(seen).toEqual([true, false])
  })
})
