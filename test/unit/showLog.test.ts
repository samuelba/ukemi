import { describe, expect, test } from 'vitest'
import {
  isGlassLogFile,
  outputChannelIds,
  selectOutputChannelId,
  workspaceIdFromStoragePath,
} from '../../src/vscode/showLog'

const extensionId = 'samuelba.ukemi-jj'
const channelName = 'Ukemi'
const base = `${extensionId}.${channelName}`
const show = (id: string) => `workbench.action.output.show.${id}`

describe('outputChannelIds', () => {
  test('collects the plain, workspace, and remote channel ids', () => {
    const found = outputChannelIds(
      [
        show(base),
        show(`${base}.workspaceId-current`),
        show(`${base}.workspaceId-other`),
        show(`${base}.remote.workspaceId-current`),
        show('workbench.action.output.show.other.ext.Ukemi'),
        'ukemi.showLog',
      ],
      extensionId,
      channelName,
    )
    expect(found).toEqual({
      plain: base,
      scoped: [`${base}.workspaceId-current`, `${base}.workspaceId-other`],
      remote: [`${base}.remote.workspaceId-current`],
    })
  })
})

describe('selectOutputChannelId', () => {
  test('uses the only workspace-scoped channel', () => {
    expect(
      selectOutputChannelId({
        plain: base,
        scoped: [`${base}.workspaceId-current`],
        remote: [],
      }),
    ).toBe(`${base}.workspaceId-current`)
  })

  test('picks the channel for the active workspace', () => {
    expect(
      selectOutputChannelId(
        {
          scoped: [`${base}.workspaceId-old`, `${base}.workspaceId-current`],
          remote: [`${base}.remote.workspaceId-current`],
        },
        'current',
      ),
    ).toBe(`${base}.workspaceId-current`)
  })

  test('uses the plain channel when no workspace scope is registered', () => {
    expect(selectOutputChannelId({ scoped: [], remote: [], plain: base })).toBe(base)
  })

  test('falls back to the remote channel', () => {
    expect(
      selectOutputChannelId({
        scoped: [],
        remote: [`${base}.remote.workspaceId-current`],
      }),
    ).toBe(`${base}.remote.workspaceId-current`)
  })

  test('does not treat a shorter workspace id as a suffix match', () => {
    expect(
      selectOutputChannelId(
        {
          scoped: [`${base}.workspaceId-not-current`, `${base}.workspaceId-current`],
          remote: [],
        },
        'current',
      ),
    ).toBe(`${base}.workspaceId-current`)
  })

  test('returns undefined when several channels are ambiguous', () => {
    expect(
      selectOutputChannelId({
        scoped: [`${base}.workspaceId-a`, `${base}.workspaceId-b`],
        remote: [],
      }),
    ).toBeUndefined()
  })
})

describe('workspaceIdFromStoragePath', () => {
  test('reads the workspace storage folder name', () => {
    expect(
      workspaceIdFromStoragePath(
        '/home/u/.config/Cursor/User/workspaceStorage/307616454f9c8998f8f3752662a3f3c2/samuelba.ukemi-jj',
      ),
    ).toBe('307616454f9c8998f8f3752662a3f3c2')
  })
})

describe('isGlassLogFile', () => {
  test('detects the workspace-scoped log file of the glass host', () => {
    expect(isGlassLogFile(['Ukemi.workspaceId-abc.20261028_deadbeef.log'], 'Ukemi')).toBe(true)
  })

  test('treats the plain log file as the classic host', () => {
    expect(isGlassLogFile(['Ukemi.log'], 'Ukemi')).toBe(false)
  })
})
