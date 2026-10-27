import { describe, expect, test } from 'vitest'
import {
  bookmarkGoToItems,
  bookmarkRefsFromList,
  resolveBookmarkGoTo,
  type BookmarkChoice,
} from '../../src/repo/goToTargets'
import type { BookmarkRef } from '../../src/repo/workspaceItems'

const local = (name: string, commitId: string): BookmarkRef => ({ name, commitId })
const remote = (name: string, remoteName: string, commitId: string): BookmarkRef => ({
  name,
  remote: remoteName,
  commitId,
})

describe('bookmarkGoToItems', () => {
  test('collapses a local bookmark and its remote when they share a commit', () => {
    const items = bookmarkGoToItems([local('main', 'abc')], [remote('main', 'origin', 'abc')])

    expect(items).toEqual([
      {
        name: 'main',
        label: '$(bookmark) main',
        description: 'local, origin',
        revision: 'abc',
      },
    ])
    expect(
      resolveBookmarkGoTo('main', [local('main', 'abc')], [remote('main', 'origin', 'abc')]),
    ).toEqual({
      kind: 'single',
      revision: 'abc',
    })
  })

  test('omits the revision when local and remote point at different commits', () => {
    const bookmarks = {
      local: [local('main', 'abc')],
      remote: [remote('main', 'origin', 'def')],
    }
    const [item] = bookmarkGoToItems(bookmarks.local, bookmarks.remote)

    expect(item).toEqual({
      name: 'main',
      label: '$(bookmark) main',
      description: 'local, origin',
    })
    expect(item?.revision).toBeUndefined()
    expect(resolveBookmarkGoTo('main', bookmarks.local, bookmarks.remote)).toEqual({
      kind: 'ambiguous',
      choices: [
        { label: 'local', revision: 'abc' },
        { label: 'main@origin', revision: 'def' },
      ] satisfies BookmarkChoice[],
    })
  })

  test('labels a remote-only bookmark with its name', () => {
    expect(bookmarkGoToItems([], [remote('main', 'origin', 'abc')])).toEqual([
      {
        name: 'main',
        label: '$(cloud) main',
        description: 'origin',
        revision: 'abc',
      },
    ])
  })

  test('asks when two remotes point at different commits', () => {
    const remotes = [remote('main', 'origin', 'abc'), remote('main', 'upstream', 'def')]

    expect(bookmarkGoToItems([], remotes)).toEqual([
      {
        name: 'main',
        label: '$(cloud) main',
        description: 'origin, upstream',
      },
    ])
    expect(resolveBookmarkGoTo('main', [], remotes)).toEqual({
      kind: 'ambiguous',
      choices: [
        { label: 'main@origin', revision: 'abc' },
        { label: 'main@upstream', revision: 'def' },
      ],
    })
  })

  test('resolves a remote-only bookmark from the full list by name', () => {
    const { local, remote } = bookmarkRefsFromList([
      {
        name: 'ci/proof-anycli-626-rosdep-medium',
        remote: 'origin',
        present: true,
        commitId: 'abc',
      },
      {
        name: 'ci/proof-anycli-626-rosdep-medium',
        remote: 'git',
        present: true,
        commitId: 'abc',
      },
      { name: 'gone', remote: 'origin', present: false, commitId: 'def' },
      { name: 'broken', remote: 'origin', present: true, commitId: null },
    ])

    expect(bookmarkGoToItems(local, remote)).toEqual([
      {
        name: 'ci/proof-anycli-626-rosdep-medium',
        label: '$(cloud) ci/proof-anycli-626-rosdep-medium',
        description: 'origin',
        revision: 'abc',
      },
    ])
    expect(resolveBookmarkGoTo('ci/proof-anycli-626-rosdep-medium', local, remote)).toEqual({
      kind: 'single',
      revision: 'abc',
    })
  })

  test('leaves an unknown name for the typed revset path', () => {
    expect(resolveBookmarkGoTo('other', [local('main', 'abc')], [])).toEqual({ kind: 'unknown' })
    expect(resolveBookmarkGoTo('main@origin', [], [remote('main', 'origin', 'abc')])).toEqual({
      kind: 'unknown',
    })
  })
})
