import { describe, expect, test } from 'vitest'
import {
  cssFamily,
  detectSystemFont,
  parseKdeFont,
  parsePangoFont,
  resolveFonts,
} from '../../src/desktop/fonts'

describe('parsePangoFont', () => {
  test('splits family, weight and size', () => {
    expect(parsePangoFont("'FiraCode Nerd Font Mono Medium 11'")).toEqual({
      family: 'FiraCode Nerd Font Mono',
      weight: '500',
      size: 14.67,
    })
  })

  test('reads plain names and drops italic', () => {
    expect(parsePangoFont('Adwaita Mono 11')).toEqual({
      family: 'Adwaita Mono',
      weight: '400',
      size: 14.67,
    })
    expect(parsePangoFont('JetBrains Mono SemiBold Italic 12')).toMatchObject({
      family: 'JetBrains Mono',
      weight: '600',
    })
  })

  test('ignores what is not a font', () => {
    expect(parsePangoFont('')).toBeNull()
    expect(parsePangoFont('12')).toBeNull()
  })
})

test('parseKdeFont reads the family and size of kdeglobals', () => {
  expect(parseKdeFont('Hack,10,-1,5,50,0,0,0,0,0')).toEqual({
    family: 'Hack',
    weight: '400',
    size: 13.33,
  })
  expect(parseKdeFont('Hack,10,-1,5,500,0,0,0,0,0,0,0,0,0,0,1,Medium')).toMatchObject({
    weight: '500',
  })
})

test('cssFamily quotes a name and keeps a list as written', () => {
  expect(cssFamily('FiraCode Nerd Font Mono')).toBe("'FiraCode Nerd Font Mono', monospace")
  expect(cssFamily("'Fira Code', monospace")).toBe("'Fira Code', monospace")
})

describe('resolveFonts', () => {
  const system = { family: 'FiraCode Nerd Font Mono', weight: '500', size: 14.67 }

  test('uses the system font by default, the terminal with its size', () => {
    expect(resolveFonts({}, system)).toEqual({
      editor: { family: "'FiraCode Nerd Font Mono', monospace", size: 13, weight: '500' },
      terminal: { family: "'FiraCode Nerd Font Mono', monospace", size: 14.67, weight: '500' },
    })
  })

  test('follows the settings, and the terminal follows the editor family', () => {
    const fonts = resolveFonts(
      {
        'desktop.editor.fontFamily': "'Iosevka', monospace",
        'desktop.editor.fontSize': 14,
        'desktop.editor.fontWeight': 'normal',
        'desktop.terminal.fontSize': 15,
      },
      system,
    )
    expect(fonts.editor).toEqual({ family: "'Iosevka', monospace", size: 14, weight: 'normal' })
    expect(fonts.terminal).toEqual({ family: "'Iosevka', monospace", size: 15, weight: 'normal' })
  })

  test('falls back to monospace without a system font', () => {
    expect(resolveFonts({}, null).editor).toEqual({
      family: 'monospace',
      size: 13,
      weight: 'normal',
    })
  })
})

describe('detectSystemFont', () => {
  const settings = (values: Record<string, string>) => async (_command: string, args: string[]) =>
    values[`${args[1]} ${args[2]}`] ?? null

  test.runIf(process.platform === 'linux')("prefers the terminal's own font", async () => {
    const read = settings({
      'org.gnome.Ptyxis use-system-font': 'false',
      'org.gnome.Ptyxis font-name': "'FiraCode Nerd Font Mono Medium 11'",
      'org.gnome.desktop.interface monospace-font-name': "'Adwaita Mono 11'",
    })
    expect((await detectSystemFont(read, '/nowhere'))?.family).toBe('FiraCode Nerd Font Mono')
  })

  test.runIf(process.platform === 'linux')(
    'uses the system monospace font when the terminal follows it',
    async () => {
      const read = settings({
        'org.gnome.Ptyxis use-system-font': 'true',
        'org.gnome.desktop.interface monospace-font-name': "'Adwaita Mono 11'",
      })
      expect((await detectSystemFont(read, '/nowhere'))?.family).toBe('Adwaita Mono')
    },
  )
})
