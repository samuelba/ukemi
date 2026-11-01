import { cpp } from '@codemirror/lang-cpp'
import { css } from '@codemirror/lang-css'
import { go } from '@codemirror/lang-go'
import { html } from '@codemirror/lang-html'
import { java } from '@codemirror/lang-java'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { php } from '@codemirror/lang-php'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sass } from '@codemirror/lang-sass'
import { yaml } from '@codemirror/lang-yaml'
import { language, StreamLanguage, type Language } from '@codemirror/language'
import { kotlin } from '@codemirror/legacy-modes/mode/clike'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { EditorState, type Extension } from '@codemirror/state'

// Kotlin and shell have no Lezer grammar, so they use CodeMirror 5's modes.
const kotlinLanguage = () => StreamLanguage.define(kotlin)
const shellLanguage = () => StreamLanguage.define(shell)

// The webview is one script, so the languages are a fixed set rather than loaded on demand.
const BY_EXTENSION: Readonly<Record<string, () => Extension>> = {
  js: () => javascript(),
  mjs: () => javascript(),
  cjs: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  mts: () => javascript({ typescript: true }),
  cts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  json: () => json(),
  jsonc: () => json(),
  md: () => markdown(),
  markdown: () => markdown(),
  css: () => css(),
  scss: () => sass(),
  sass: () => sass({ indented: true }),
  html: () => html(),
  htm: () => html(),
  php: () => php(),
  phtml: () => php(),
  py: () => python(),
  rs: () => rust(),
  go: () => go(),
  c: () => cpp(),
  h: () => cpp(),
  cc: () => cpp(),
  cpp: () => cpp(),
  cxx: () => cpp(),
  hh: () => cpp(),
  hpp: () => cpp(),
  hxx: () => cpp(),
  tpp: () => cpp(),
  ino: () => cpp(),
  java: () => java(),
  kt: () => kotlinLanguage(),
  kts: () => kotlinLanguage(),
  sh: () => shellLanguage(),
  bash: () => shellLanguage(),
  zsh: () => shellLanguage(),
  ksh: () => shellLanguage(),
  yml: () => yaml(),
  yaml: () => yaml(),
}

// Files that are known by their whole name rather than an extension.
const BY_NAME: Readonly<Record<string, () => Extension>> = {
  '.bashrc': shellLanguage,
  '.bash_profile': shellLanguage,
  '.bash_aliases': shellLanguage,
  '.profile': shellLanguage,
  '.zshrc': shellLanguage,
  '.zprofile': shellLanguage,
  '.zshenv': shellLanguage,
  PKGBUILD: shellLanguage,
}

const SHELL_SHEBANG = /^#!\s*\S*(?:\/|\s)(?:env\s+)?(?:ba|z|k|da)?sh\b/

// Picks the language by file name, then by extension, then by a shell script's `#!` line.
export function languageFor(path: string, text = ''): Extension {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const make =
    BY_NAME[name] ?? (dot > 0 ? BY_EXTENSION[name.slice(dot + 1).toLowerCase()] : undefined)
  if (make) {
    return make()
  }
  const firstLine = text.split('\n', 1)[0] ?? ''
  return SHELL_SHEBANG.test(firstLine) ? shellLanguage() : []
}

// The language alone, for highlighting text outside an editor. Null when none matches.
export function parserFor(path: string, text = ''): Language | null {
  return EditorState.create({ extensions: languageFor(path, text) }).facet(language)
}
