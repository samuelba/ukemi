import { describe, expect, test } from 'vitest'
import type { ViewState } from '../../shared/protocol'
import {
  keepIfEqual,
  keepUnchanged,
  withUnchangedObjects,
} from '../../webview/src/graph/keepUnchanged'

const row = (id: string, text: string) => ({ commitId: id, text })

describe('keepUnchanged', () => {
  test('keeps the objects of rows that did not change', () => {
    const before = [row('a', 'one'), row('b', 'two')]
    const after = keepUnchanged(before, [row('a', 'one'), row('b', 'changed'), row('c', 'new')])

    expect(after[0]).toBe(before[0])
    expect(after[1]).not.toBe(before[1])
    expect(after[1]).toEqual(row('b', 'changed'))
    expect(after[2]).toEqual(row('c', 'new'))
  })

  test('takes the new rows when there were none before', () => {
    const next = [row('a', 'one')]
    expect(keepUnchanged(undefined, next)[0]).toBe(next[0])
  })
})

describe('keepIfEqual', () => {
  test('keeps the previous object when the new one has the same values', () => {
    const before = { a: 1, b: [2] }
    expect(keepIfEqual(before, { a: 1, b: [2] })).toBe(before)
    expect(keepIfEqual(before, { a: 1, b: [3] })).toEqual({ a: 1, b: [3] })
    expect(keepIfEqual(undefined, before)).toBe(before)
  })
})

describe('withUnchangedObjects', () => {
  const state = (repoId: string, text: string) =>
    ({
      settings: { showGitTags: true },
      graph: { repoId, commits: [row('a', text)], workingCopyFiles: [] },
    }) as unknown as ViewState

  test('keeps the commits and settings of a refresh that changed nothing', () => {
    const before = state('/repo', 'one')
    const after = withUnchangedObjects(before, state('/repo', 'one'))

    expect(after.settings).toBe(before.settings)
    expect(after.graph?.commits[0]).toBe(before.graph?.commits[0])
    expect(after.graph?.workingCopyFiles).toBe(before.graph?.workingCopyFiles)
  })

  test('takes every commit of another repository', () => {
    const before = state('/repo', 'one')
    const after = withUnchangedObjects(before, state('/other', 'one'))

    expect(after.graph?.commits[0]).not.toBe(before.graph?.commits[0])
  })
})
