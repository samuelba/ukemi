import { describe, expect, test } from 'vitest'
import type { RepoSummary } from '../../shared/protocol'
import {
  arrangeTabs,
  EMPTY_PREFS,
  move,
  pin,
  readPrefs,
  rename,
  unpin,
  type RepoTabPrefs,
} from '../../src/desktop/repoTabs'

function repo(id: string): RepoSummary {
  return { id, label: id.slice(1), kind: 'jj', changedFiles: 0 }
}

// As the registry hands them over: by label.
const REPOS = ['/a', '/b', '/c', '/d'].map(repo)

function ids(prefs: RepoTabPrefs, repos: RepoSummary[] = REPOS): string[] {
  return arrangeTabs(repos, prefs).map((tab) => tab.id)
}

describe('arrangeTabs', () => {
  test('keeps the registry order without preferences', () => {
    expect(ids(EMPTY_PREFS)).toEqual(['/a', '/b', '/c', '/d'])
  })

  test('puts pinned tabs first, then the saved order, then new repositories', () => {
    const prefs = { order: ['/d', '/b'], names: {}, pinned: ['/c'] }
    expect(ids(prefs)).toEqual(['/c', '/d', '/b', '/a'])
    const tabs = arrangeTabs(REPOS, prefs)
    expect(tabs[0]).toMatchObject({ id: '/c', isPinned: true })
    expect(tabs[1]).toMatchObject({ id: '/d', isPinned: false })
  })

  test('shows a custom name and keeps the folder label', () => {
    const [first] = arrangeTabs([repo('/a')], { ...EMPTY_PREFS, names: { '/a': 'Mono' } })
    expect(first).toMatchObject({ label: 'Mono', folderLabel: 'a' })
  })

  test('leaves out preferences of repositories that are not open', () => {
    expect(
      ids({ order: ['/gone', '/b'], names: {}, pinned: ['/gone'] }, [repo('/a'), repo('/b')]),
    ).toEqual(['/b', '/a'])
  })
})

describe('tab preferences', () => {
  test('renames and resets with a blank name', () => {
    const named = rename(EMPTY_PREFS, '/a', '  Mono  ')
    expect(named.names).toEqual({ '/a': 'Mono' })
    expect(rename(named, '/a', '   ').names).toEqual({})
  })

  test('pins to the end of the pinned tabs and unpins to the front of the others', () => {
    const pinned = pin(pin(EMPTY_PREFS, '/c'), '/a')
    expect(ids(pinned)).toEqual(['/c', '/a', '/b', '/d'])
    expect(ids(unpin(pinned, '/c'))).toEqual(['/a', '/c', '/b', '/d'])
  })

  test('moves a tab within its own group', () => {
    const visible = ids(EMPTY_PREFS)
    expect(ids(move(EMPTY_PREFS, visible, '/d', 0))).toEqual(['/d', '/a', '/b', '/c'])
    expect(ids(move(EMPTY_PREFS, visible, '/a', 2))).toEqual(['/b', '/c', '/a', '/d'])

    const pinned = pin(EMPTY_PREFS, '/c')
    const shown = ids(pinned)
    // A drop among the pinned tabs stops at their edge.
    expect(ids(move(pinned, shown, '/d', 0))).toEqual(['/c', '/d', '/a', '/b'])
    expect(ids(move(pinned, shown, '/c', 3))).toEqual(['/c', '/a', '/b', '/d'])
  })

  test('reads stored preferences defensively', () => {
    expect(readPrefs(undefined)).toEqual(EMPTY_PREFS)
    expect(readPrefs('nope')).toEqual(EMPTY_PREFS)
    expect(readPrefs({ order: ['/a', 3], names: { '/a': 'A', '/b': 7 }, pinned: 'x' })).toEqual({
      order: ['/a'],
      names: { '/a': 'A' },
      pinned: [],
    })
  })
})
