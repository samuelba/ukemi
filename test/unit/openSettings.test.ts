import { describe, expect, test } from 'vitest'
import { settingsCommandHref } from '../../shared/settingsLink'
import { cursorSettingsLink } from '../../src/vscode/openSettings'

describe('cursorSettingsLink', () => {
  test('keeps a setting id in the path', () => {
    expect(cursorSettingsLink('cursor', 'ukemi.jjPath')).toEqual({
      scheme: 'cursor',
      authority: 'settings',
      path: '/ukemi.jjPath',
    })
  })

  test('drops an extension filter', () => {
    expect(cursorSettingsLink('cursor', '@ext:ukemi.ukemi')).toEqual({
      scheme: 'cursor',
      authority: 'settings',
      path: '/',
    })
  })
})

describe('settingsCommandHref', () => {
  test('keeps an extension filter as the command argument', () => {
    const href = settingsCommandHref('@ext:ukemi.ukemi')
    const query = href.slice(href.indexOf('?') + 1)
    expect(href.startsWith('command:workbench.action.openSettings?')).toBe(true)
    expect(JSON.parse(decodeURIComponent(query))).toBe('@ext:ukemi.ukemi')
  })
})
