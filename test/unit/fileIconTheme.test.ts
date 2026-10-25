import { describe, expect, test } from 'vitest'
import {
  flattenIconTheme,
  iconForPath,
  parseFontCharacter,
  type FlattenIconThemeOptions,
  type RawIconThemeDocument,
} from '../../shared/fileIconTheme'

const options: FlattenIconThemeOptions = {
  languages: { extensions: {}, filenames: {} },
  fontUri: (path) => path,
  iconUri: (path) => path,
}

function theme(document: RawIconThemeDocument, variant: 'dark' | 'light' = 'dark') {
  return flattenIconTheme(document, variant, options)
}

describe('file icon theme', () => {
  test('matches package.json by file name before the json extension', () => {
    const icons = theme({
      iconDefinitions: {
        json: { fontCharacter: '\\E055' },
        npm: { fontCharacter: '\\E067' },
      },
      fileExtensions: { json: 'json' },
      fileNames: { 'package.json': 'npm' },
    })

    expect(iconForPath(icons, 'package.json')?.fontCharacter).toBe('\uE067')
    expect(iconForPath(icons, 'other.json')?.fontCharacter).toBe('\uE055')
  })

  test('matches foo.spec.ts by the longer extension', () => {
    const icons = theme({
      iconDefinitions: {
        ts: { fontCharacter: '\\E099' },
        spec: { fontCharacter: '\\E001' },
      },
      fileExtensions: { ts: 'ts', 'spec.ts': 'spec' },
    })

    expect(iconForPath(icons, 'foo.spec.ts')?.fontCharacter).toBe('\uE001')
  })

  test('matches globalCommands.ts by the typescript language', () => {
    const icons = flattenIconTheme(
      {
        iconDefinitions: {
          plain: { fontCharacter: '\\E000' },
          ts: { fontCharacter: '\\E099' },
        },
        file: 'plain',
        languageIds: { typescript: 'ts' },
      },
      'dark',
      {
        ...options,
        languages: { extensions: { ts: 'typescript' }, filenames: {} },
      },
    )

    expect(iconForPath(icons, 'globalCommands.ts')?.fontCharacter).toBe('\uE099')
  })

  test('uses the light glyph when the light section overrides the dark one', () => {
    const document: RawIconThemeDocument = {
      iconDefinitions: {
        dark: { fontCharacter: '\\E001' },
        light: { fontCharacter: '\\E002' },
      },
      fileExtensions: { ts: 'dark' },
      light: { fileExtensions: { ts: 'light' } },
    }

    expect(iconForPath(theme(document), 'a.ts')?.fontCharacter).toBe('\uE001')
    expect(iconForPath(theme(document, 'light'), 'a.ts')?.fontCharacter).toBe('\uE002')
  })

  test('parses \\E099 as one private-use character', () => {
    const character = parseFontCharacter('\\E099')

    expect(character).toBe('\uE099')
    expect(character).toHaveLength(1)
  })
})
