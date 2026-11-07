import { describe, expect, test } from 'vitest'
import type { BookmarkTracking, ChangedFile } from '../../shared/model'
import type { CommitView, GraphState, RequestBadge, ViewState } from '../../shared/protocol'
import { summarizeStatus, type StatusItem } from '../../shared/statusSummary'

const NOW = Date.parse('2026-11-02T12:00:00Z')
const WC = 'w'.repeat(40)
const PARENT = 'p'.repeat(40)

function commit(overrides: Partial<CommitView> = {}): CommitView {
  const id = overrides.commitId ?? 'c'.repeat(40)
  const signature = { name: 'A', email: 'a@x', timestamp: '2026-11-01T00:00:00Z' }
  return {
    changeId: 'kxkpvplvmqsy',
    changePrefix: 'k',
    commitId: id,
    commitPrefix: id.slice(0, 1),
    parents: [],
    description: 'feat: thing\n\nbody\n',
    author: signature,
    committer: signature,
    localBookmarks: [],
    remoteBookmarks: [],
    tags: [],
    workingCopies: [],
    changeOffset: null,
    isWorkingCopy: false,
    isEmpty: false,
    hasConflict: false,
    isImmutable: false,
    isDivergent: false,
    isHidden: false,
    isMine: true,
    row: { id, column: 0, width: 1, incoming: [], outgoing: [] },
    isTrunk: false,
    requests: [],
    ...overrides,
  } as CommitView
}

function graph(overrides: Partial<GraphState> = {}): GraphState {
  return {
    repoId: '/repo',
    commits: [commit({ isWorkingCopy: true, commitId: WC })],
    workingCopyFiles: [],
    workspaces: [],
    filter: 'recent',
    depth: '7d',
    revset: null,
    isTruncated: false,
    hasRemotes: true,
    hasUnpushed: false,
    canUndo: true,
    canRedo: false,
    currentBookmarks: [],
    tracking: [],
    operationId: 'abcdef0123456789',
    trunkName: 'main',
    forge: null,
    ...overrides,
  }
}

function state(overrides: Partial<ViewState> = {}): ViewState {
  return {
    status: 'ready',
    repos: [],
    activeRepoId: '/repo',
    graph: graph(),
    busy: null,
    error: null,
    settings: {
      changeIdLength: 4,
      showFullPaths: false,
      showLineStats: false,
      showGitTags: true,
      previewDrops: true,
      changedFilesView: 'list',
      ciOnlyMine: false,
    },
    autoFetch: { enabled: true, interval: '10m', isRunning: false, lastFetch: null },
    ...overrides,
  }
}

function item(items: StatusItem[], id: StatusItem['id']): StatusItem | undefined {
  return items.find((i) => i.id === id)
}

function tracking(overrides: Partial<BookmarkTracking>): BookmarkTracking {
  return { name: 'feature', remote: 'origin', tracked: true, ahead: 0, behind: 0, ...overrides }
}

function request(overrides: Partial<RequestBadge> = {}): RequestBadge {
  return {
    number: 42,
    title: 'Feature',
    url: 'https://example.com/pr/42',
    state: 'open',
    ci: 'success',
    isMine: true,
    checks: [],
    headBranch: 'feature',
    baseBranch: 'main',
    ...overrides,
  }
}

// The working copy with one local bookmark on it.
function bookmarkedGraph(conflict: boolean, rows: BookmarkTracking[]): GraphState {
  return graph({
    commits: [
      commit({
        isWorkingCopy: true,
        commitId: WC,
        localBookmarks: [{ name: 'feature', synced: false, conflict }],
      }),
    ],
    tracking: rows,
  })
}

describe('summarizeStatus', () => {
  test('shows nothing without a graph', () => {
    expect(summarizeStatus(state({ status: 'no-repo', graph: null }), NOW)).toEqual([])
  })

  test('describes the working copy and reveals it on click', () => {
    expect(item(summarizeStatus(state(), NOW), 'change')).toMatchObject({
      code: 'kxkp',
      text: 'feat: thing',
      tone: 'normal',
      action: { kind: 'reveal', commitId: WC },
    })
  })

  test('marks a conflicted or divergent working copy', () => {
    for (const flag of ['hasConflict', 'isDivergent'] as const) {
      const commits = [commit({ isWorkingCopy: true, commitId: WC, [flag]: true })]
      const change = item(summarizeStatus(state({ graph: graph({ commits }) }), NOW), 'change')
      expect(change).toMatchObject({ tone: 'warning', icon: 'warning' })
    }
  })

  test('says when the working copy has no description', () => {
    const commits = [commit({ isWorkingCopy: true, commitId: WC, description: '' })]
    const change = item(summarizeStatus(state({ graph: graph({ commits }) }), NOW), 'change')
    expect(change).toMatchObject({ code: 'kxkp', text: '(no description)' })
  })

  test('prefers the bookmark on the working copy and shows how it tracks', () => {
    const commits = [
      commit({
        isWorkingCopy: true,
        commitId: WC,
        localBookmarks: [{ name: 'here', synced: false, conflict: false }],
      }),
      commit({
        commitId: PARENT,
        localBookmarks: [{ name: 'feature', synced: true, conflict: false }],
      }),
    ]
    const rows = [tracking({ name: 'here', ahead: 2, behind: 1 })]
    const items = summarizeStatus(
      state({ graph: graph({ commits, currentBookmarks: ['feature'], tracking: rows }) }),
      NOW,
    )
    expect(item(items, 'bookmark')).toMatchObject({
      code: 'here',
      text: '↑2 ↓1',
      action: { kind: 'bookmarkMenu', context: { bookmark: 'here', commitId: WC } },
    })
  })

  test('falls back to the nearest bookmarks below the working copy', () => {
    const commits = [
      commit({ isWorkingCopy: true, commitId: WC }),
      commit({
        commitId: PARENT,
        localBookmarks: [{ name: 'feature', synced: true, conflict: false }],
      }),
    ]
    const items = summarizeStatus(
      state({
        graph: graph({ commits, currentBookmarks: ['feature', 'other'], tracking: [tracking({})] }),
      }),
      NOW,
    )
    const bookmark = item(items, 'bookmark')
    expect(bookmark).toMatchObject({ code: 'feature +1', text: '↑0 ↓0' })
    expect(bookmark?.tooltip).toContain('other')
    expect(bookmark?.action).toMatchObject({ context: { commitId: PARENT } })
  })

  test('shows trunk dimmed when the stack has no bookmark', () => {
    expect(item(summarizeStatus(state(), NOW), 'bookmark')).toMatchObject({
      code: 'main',
      tone: 'muted',
      action: null,
    })
  })

  test('says when a bookmark is untracked, local only or conflicted', () => {
    const bookmark = (conflict: boolean, rows: BookmarkTracking[]) =>
      item(summarizeStatus(state({ graph: bookmarkedGraph(conflict, rows) }), NOW), 'bookmark')
    expect(bookmark(false, [tracking({ tracked: false })])?.text).toBe('untracked')
    expect(bookmark(false, [])?.text).toBe('local only')
    expect(bookmark(true, [])).toMatchObject({ text: 'conflicted', tone: 'warning' })
  })

  test('says nothing about tracking when the repository has no remote', () => {
    const noRemote = { ...bookmarkedGraph(false, []), hasRemotes: false }
    expect(item(summarizeStatus(state({ graph: noRemote }), NOW), 'bookmark')).toMatchObject({
      code: 'feature',
      text: '',
    })
  })

  test('prefers origin over other remotes', () => {
    const rows = [tracking({ remote: 'fork', ahead: 5 }), tracking({ ahead: 1 })]
    expect(
      item(summarizeStatus(state({ graph: bookmarkedGraph(false, rows) }), NOW), 'bookmark')?.text,
    ).toBe('↑1 ↓0')
  })

  test('prefers a tracked remote over an untracked origin', () => {
    const rows = [tracking({ tracked: false }), tracking({ remote: 'upstream', behind: 3 })]
    expect(
      item(summarizeStatus(state({ graph: bookmarkedGraph(false, rows) }), NOW), 'bookmark')?.text,
    ).toBe('↑0 ↓3')
  })

  test('still shows a current bookmark whose change is outside the graph', () => {
    const items = summarizeStatus(
      state({
        graph: graph({
          currentBookmarks: ['far'],
          tracking: [tracking({ name: 'far', ahead: 4 })],
        }),
      }),
      NOW,
    )
    expect(item(items, 'bookmark')).toMatchObject({ code: 'far', text: '↑4 ↓0', action: null })
  })

  test('counts the conflicted files of the working copy and the conflicted changes', () => {
    const files: ChangedFile[] = [
      { path: 'a', sourcePath: 'a', status: 'modified', isConflicted: true },
      { path: 'b', sourcePath: 'b', status: 'modified', isConflicted: true },
      { path: 'c', sourcePath: 'c', status: 'modified', isConflicted: false },
    ]
    const commits = [
      commit({ isWorkingCopy: true, commitId: WC, hasConflict: true }),
      commit({ commitId: PARENT, hasConflict: true }),
    ]
    const conflicts = item(
      summarizeStatus(state({ graph: graph({ commits, workingCopyFiles: files }) }), NOW),
      'conflicts',
    )
    expect(conflicts).toMatchObject({
      text: '2 conflicted files, 2 conflicted changes',
      tone: 'warning',
    })
  })

  test('leads to the oldest conflicted change, where the conflict came in', () => {
    const commits = [
      commit({ isWorkingCopy: true, commitId: WC, hasConflict: true }),
      commit({ commitId: PARENT, hasConflict: true, isDivergent: true }),
    ]
    const conflicts = item(summarizeStatus(state({ graph: graph({ commits }) }), NOW), 'conflicts')
    expect(conflicts).toMatchObject({
      text: '2 conflicted changes, 1 divergent',
      action: { kind: 'resolve', commitId: PARENT },
    })
  })

  test('leads to the working copy when only its files say they are conflicted', () => {
    const files: ChangedFile[] = [
      { path: 'a', sourcePath: 'a', status: 'modified', isConflicted: true },
    ]
    const conflicts = item(
      summarizeStatus(state({ graph: graph({ workingCopyFiles: files }) }), NOW),
      'conflicts',
    )
    expect(conflicts).toMatchObject({
      text: '1 conflicted file',
      action: { kind: 'resolve', commitId: WC },
    })
  })

  test('has no conflict item when nothing is conflicted', () => {
    expect(item(summarizeStatus(state(), NOW), 'conflicts')).toBeUndefined()
  })

  test('shows the request of the bookmarked change with its CI state', () => {
    const commits = [
      commit({
        isWorkingCopy: true,
        commitId: WC,
        localBookmarks: [{ name: 'feature', synced: true, conflict: false }],
        requests: [request({ ci: 'failure' })],
      }),
    ]
    expect(
      item(summarizeStatus(state({ graph: graph({ commits }) }), NOW), 'request'),
    ).toMatchObject({
      text: '#42 open',
      icon: 'error',
      action: { kind: 'openUrl', url: 'https://example.com/pr/42' },
    })
  })

  test('warns when the request is left from an earlier refresh', () => {
    const commits = [
      commit({
        isWorkingCopy: true,
        commitId: WC,
        localBookmarks: [{ name: 'feature', synced: true, conflict: false }],
        requests: [request()],
      }),
    ]
    const forge = { kind: 'github' as const, host: 'github.com', isSignedIn: true }
    const shown = (refreshError?: string) =>
      item(
        summarizeStatus(
          state({
            graph: graph({
              commits,
              forge: { ...forge, ...(refreshError ? { refreshError } : {}) },
            }),
          }),
          NOW,
        ),
        'request',
      )

    expect(shown('HTTP 502')).toMatchObject({ tone: 'warning' })
    expect(shown('HTTP 502')?.tooltip).toContain(
      'Not updated: HTTP 502. Shown from the last successful refresh.',
    )
    expect(shown()).toMatchObject({ tone: 'normal' })
    expect(shown()?.tooltip).not.toContain('Not updated')
  })

  test('has no request item without a request', () => {
    expect(item(summarizeStatus(state(), NOW), 'request')).toBeUndefined()
  })

  test('describes fetching', () => {
    const sync = (overrides: Partial<ViewState>) =>
      item(summarizeStatus(state(overrides), NOW), 'sync')
    const autoFetch = (isRunning: boolean, lastFetch: number | null, enabled = true) => ({
      autoFetch: { enabled, interval: '10m', isRunning, lastFetch },
    })
    expect(sync({ busy: 'Push' })).toMatchObject({ text: 'Push…', isSpinning: true })
    expect(sync(autoFetch(true, null))).toMatchObject({ text: 'Fetching…', isSpinning: true })
    expect(sync(autoFetch(false, NOW - 180_000))).toMatchObject({
      text: 'Fetched 3m ago',
      action: { kind: 'command', command: 'ukemi.fetch' },
    })
    expect(sync({})).toMatchObject({ text: 'Fetch', icon: 'sync' })
    expect(sync(autoFetch(false, null, false))).toMatchObject({ icon: 'sync-ignored' })
    expect(sync({})?.tooltip).toContain('abcdef012345')
    expect(sync(autoFetch(false, NOW - 40 * 86_400_000))?.text).toMatch(
      /^Fetched [A-Z][a-z]{2} \d+$/,
    )
  })

  test('shows an error that opens the log', () => {
    expect(item(summarizeStatus(state({ error: 'push failed' }), NOW), 'error')).toMatchObject({
      text: 'push failed',
      tone: 'error',
      action: { kind: 'showLog' },
    })
  })
})
