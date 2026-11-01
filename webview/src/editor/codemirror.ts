import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { EditorState, type Extension } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  type ViewUpdate,
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { conflictExtension, nextConflict, previousConflict } from './conflicts'
import { languageFor } from './languages'

export interface EditorSetup {
  path: string
  readOnly: boolean
  onSave: () => void
  onUpdate: (update: ViewUpdate) => void
}

// Colors come from editor.css, which defines them for the light and the dark palette.
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: 'var(--syntax-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--syntax-string)' },
  { tag: [tags.comment, tags.meta], color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--syntax-number)' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--syntax-function)',
  },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--syntax-type)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--syntax-property)' },
  { tag: tags.heading, color: 'var(--syntax-keyword)', fontWeight: '600' },
  { tag: tags.link, color: 'var(--vscode-textLink-foreground)', textDecoration: 'underline' },
  { tag: tags.invalid, color: 'var(--vscode-errorForeground)' },
])

const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--vscode-foreground)',
    backgroundColor: 'var(--vscode-editor-background)',
    fontSize: 'var(--vscode-editor-font-size)',
  },
  '.cm-scroller': { fontFamily: 'var(--vscode-editor-font-family)', lineHeight: '1.55' },
  '.cm-gutters': {
    backgroundColor: 'var(--vscode-editor-background)',
    color: 'var(--ink-faint)',
    borderRight: '1px solid var(--rule)',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--vscode-list-hoverBackground)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--ink)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--ai-wash)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--paper-raised)',
    color: 'var(--ink)',
    borderColor: 'var(--rule)',
  },
})

export function createState(text: string, setup: EditorSetup): EditorState {
  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    syntaxHighlighting(highlight),
    languageFor(setup.path, text),
    conflictExtension(),
    theme,
    keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          setup.onSave()
          return true
        },
      },
      { key: 'F7', run: nextConflict },
      { key: 'Shift-F7', run: previousConflict },
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
    ]),
    EditorView.updateListener.of(setup.onUpdate),
    EditorState.readOnly.of(setup.readOnly),
    EditorView.editable.of(!setup.readOnly),
  ]
  // A CRLF file keeps its line endings: `sliceDoc` joins lines with the separator.
  if (text.includes('\r\n')) {
    extensions.push(EditorState.lineSeparator.of('\r\n'))
  }
  return EditorState.create({ doc: text, extensions })
}
