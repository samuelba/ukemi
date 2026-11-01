import { language } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { languageFor, parserFor } from '../../webview/src/editor/languages'
import { highlightLines } from '../../webview/src/editor/syntaxClasses'

function languageName(path: string, text = ''): string | null {
  const state = EditorState.create({ doc: text, extensions: languageFor(path, text) })
  return state.facet(language)?.name ?? null
}

describe('languageFor', () => {
  test.each([
    ['src/main.c', 'cpp'],
    ['include/vec.hpp', 'cpp'],
    ['lib/Thing.java', 'java'],
    ['app/Main.kt', 'kotlin'],
    ['build.gradle.kts', 'kotlin'],
    ['style/site.scss', 'sass'],
    ['style/old.sass', 'sass'],
    ['web/index.php', 'php'],
    ['scripts/deploy.sh', 'shell'],
    ['home/.zshrc', 'shell'],
    ['PKGBUILD', 'shell'],
    ['src/app.ts', 'typescript'],
  ])('reads %s as %s', (path, name) => {
    expect(languageName(path)).toBe(name)
  })

  test('reads an extensionless script by its #! line', () => {
    expect(languageName('bin/release', '#!/usr/bin/env bash\necho hi\n')).toBe('shell')
    expect(languageName('bin/setup', '#!/bin/sh\n')).toBe('shell')
    expect(languageName('bin/tool', '#!/usr/bin/env python3\n')).toBeNull()
  })

  test('leaves unknown files plain', () => {
    expect(languageName('LICENSE', 'MIT\n')).toBeNull()
  })
})

describe('highlightLines', () => {
  const classes = (text: string, path: string) =>
    highlightLines(text, parserFor(path, text))?.map((line) => line.map((t) => t.cls))

  test('colors a comment on every line it spans', () => {
    expect(classes('/* one\ntwo */\nlet x = 1\n', 'a.ts')).toEqual([
      ['tok-comment'],
      ['tok-comment'],
      ['tok-keyword', 'tok-number'],
      [],
    ])
  })

  test('gives offsets within each line', () => {
    const lines = highlightLines('x\n  "hi"\n', parserFor('a.js'))
    expect(lines?.[1]).toEqual([{ from: 2, to: 6, cls: 'tok-string' }])
  })

  test('colors a language that uses a CodeMirror 5 mode', () => {
    expect(classes('# note\n', 'run.sh')?.[0]).toEqual(['tok-comment'])
  })

  test('leaves an unknown file uncolored', () => {
    expect(highlightLines('MIT\n', parserFor('LICENSE', 'MIT\n'))).toBeNull()
  })
})
