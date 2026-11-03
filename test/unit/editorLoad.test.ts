import { describe, expect, test } from 'vitest'
import { loadAction } from '../../webview/src/editor/loadAction'

const shown = { path: 'a.txt' }

describe('loadAction', () => {
  test('shows the first file and a file the user switched to', () => {
    expect(
      loadAction({
        shown: null,
        next: { path: 'a.txt', text: '' },
        saving: null,
        reverting: false,
        isDirty: false,
      }),
    ).toBe('replace')
    expect(
      loadAction({
        shown,
        next: { path: 'b.txt', text: '' },
        saving: null,
        reverting: false,
        isDirty: true,
      }),
    ).toBe('replace')
  })

  test('drops the edits when the user asked to revert', () => {
    expect(
      loadAction({
        shown,
        next: { path: 'a.txt', text: 'x' },
        saving: null,
        reverting: true,
        isDirty: true,
      }),
    ).toBe('replace')
  })

  test('keeps the document and its undo history after a save', () => {
    expect(
      loadAction({
        shown,
        next: { path: 'a.txt', text: 'saved' },
        saving: 'saved',
        reverting: false,
        isDirty: true,
      }),
    ).toBe('rebase')
  })

  test('loads the file again when the user chose to reload instead of overwriting', () => {
    expect(
      loadAction({
        shown,
        next: { path: 'a.txt', text: 'theirs' },
        saving: 'mine',
        reverting: false,
        isDirty: true,
      }),
    ).toBe('replace')
  })

  test('keeps unsaved edits when the file is loaded again unasked', () => {
    expect(
      loadAction({
        shown,
        next: { path: 'a.txt', text: 'theirs' },
        saving: null,
        reverting: false,
        isDirty: true,
      }),
    ).toBe('keep')
    expect(
      loadAction({
        shown,
        next: { path: 'a.txt', text: 'theirs' },
        saving: null,
        reverting: false,
        isDirty: false,
      }),
    ).toBe('replace')
  })
})
