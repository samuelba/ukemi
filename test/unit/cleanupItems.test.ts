import { describe, expect, test } from 'vitest'
import type { CleanupSnapshot } from '../../shared/cleanup'
import {
  classifyBookmarks,
  classifyDivergent,
  classifyWorkspaces,
  cleanupSteps,
  type BookmarkRecord,
  type DivergentCommit,
  type WorkspaceRecord,
} from '../../src/repo/cleanupItems'

function local(name: string, overrides: Partial<BookmarkRecord> = {}): BookmarkRecord {
  return {
    name,
    remote: null,
    present: true,
    conflict: false,
    tracked: false,
    description: '',
    inTrunk: false,
    ...overrides,
  }
}

function remote(
  name: string,
  remoteName: string,
  overrides: Partial<BookmarkRecord> = {},
): BookmarkRecord {
  return {
    name,
    remote: remoteName,
    present: true,
    conflict: false,
    tracked: true,
    description: '',
    inTrunk: false,
    ...overrides,
  }
}

function workspace(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    name: 'other',
    description: 'notes',
    isEmpty: false,
    isCurrent: false,
    isOpen: false,
    rootMissing: false,
    ...overrides,
  }
}

function commit(overrides: Partial<DivergentCommit> = {}): DivergentCommit {
  return {
    changeId: 'change',
    changePrefix: 'cha',
    commitId: 'a'.repeat(40),
    commitPrefix: 'aaaa',
    parents: [],
    description: 'work',
    timestamp: '2026-01-01T00:00:00Z',
    isWorkingCopy: false,
    isImmutable: false,
    isDivergent: true,
    ...overrides,
  }
}

describe('classifyBookmarks', () => {
  test('checks a bookmark already in trunk and hides the trunk bookmark', () => {
    const rows = [
      local('main', { inTrunk: true, description: 'trunk\n' }),
      local('landed', { inTrunk: true, description: 'first\n' }),
      remote('landed', 'origin', { inTrunk: true }),
    ]

    expect(classifyBookmarks(rows, 'main')).toEqual([
      {
        name: 'landed',
        reason: 'merged',
        detail: 'Already in trunk (main).',
        description: 'first',
        checked: true,
      },
    ])
  })

  test('checks a local bookmark whose tracked remote is gone', () => {
    const rows = [
      local('topic', { conflict: true }),
      remote('topic', 'git'),
      remote('topic', 'origin', { present: false }),
    ]

    expect(classifyBookmarks(rows, 'main')[0]).toMatchObject({
      name: 'topic',
      reason: 'deleted-remote',
      checked: true,
    })
  })

  test('hides a bookmark that still tracks a live remote', () => {
    const rows = [local('feature'), remote('feature', 'origin')]

    expect(classifyBookmarks(rows, 'main')).toEqual([])
  })

  test('leaves a conflicted bookmark unchecked when the remote still exists', () => {
    const rows = [local('topic', { conflict: true }), remote('topic', 'origin')]

    expect(classifyBookmarks(rows, 'main')).toEqual([
      {
        name: 'topic',
        reason: 'conflict',
        detail: 'Bookmark is conflicted.',
        description: '',
        checked: false,
      },
    ])
  })
})

describe('classifyWorkspaces', () => {
  test('checks a missing folder and hides the current workspace', () => {
    const rows = [
      workspace({ name: 'default', isCurrent: true, rootMissing: false }),
      workspace({ name: 'gone', rootMissing: true, isEmpty: true }),
      workspace({ name: 'open', isOpen: true }),
      workspace({ name: 'kept', description: 'still working' }),
    ]

    expect(classifyWorkspaces(rows)).toEqual([
      { name: 'gone', detail: 'Working copy folder is missing.', checked: true },
      { name: 'kept', detail: 'still working', checked: false },
    ])
  })

  test('marks an empty workspace', () => {
    expect(classifyWorkspaces([workspace({ isEmpty: true, description: '' })])).toEqual([
      { name: 'other', detail: '(empty)', checked: false },
    ])
  })
})

describe('classifyDivergent', () => {
  test('keeps the working copy when another revision is newer', () => {
    const older = 'a'.repeat(40)
    const newer = 'b'.repeat(40)
    const groups = classifyDivergent([
      commit({
        commitId: older,
        commitPrefix: 'aaaa',
        description: 'side A',
        timestamp: '2026-01-01T00:00:00Z',
        isWorkingCopy: true,
      }),
      commit({
        commitId: newer,
        commitPrefix: 'bbbb',
        description: 'side B',
        timestamp: '2026-02-01T00:00:00Z',
      }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.revisions.find((revision) => revision.commitId === older)?.checked).toBe(
      false,
    )
    expect(groups[0]?.revisions.find((revision) => revision.commitId === newer)?.checked).toBe(true)
  })

  test('refuses to drop a revision that has an immutable child', () => {
    const parent = 'a'.repeat(40)
    const child = 'c'.repeat(40)
    const other = 'b'.repeat(40)
    const groups = classifyDivergent([
      commit({ commitId: parent, commitPrefix: 'aaaa' }),
      commit({
        commitId: child,
        commitPrefix: 'cccc',
        parents: [parent],
        isDivergent: false,
        isImmutable: true,
      }),
      commit({ commitId: other, commitPrefix: 'bbbb', timestamp: '2026-03-01T00:00:00Z' }),
    ])

    const revisions = groups[0]?.revisions ?? []
    expect(revisions.find((revision) => revision.commitId === parent)).toMatchObject({
      canDrop: false,
      checked: false,
    })
    expect(revisions.find((revision) => revision.commitId === other)).toMatchObject({
      canDrop: true,
      checked: true,
    })
  })
})

describe('cleanupSteps', () => {
  test('forgets bookmarks, rebases children, abandons drops, then forgets workspaces', () => {
    const snapshot: CleanupSnapshot = {
      bookmarks: [
        {
          name: 'landed',
          reason: 'merged',
          detail: '',
          description: '',
          checked: true,
        },
      ],
      workspaces: [{ name: 'old', detail: '', checked: true }],
      divergent: [
        {
          changeId: 'change',
          changePrefix: 'cha',
          revisions: [
            {
              commitId: 'keep',
              commitPrefix: 'k',
              description: '',
              timestamp: '',
              isWorkingCopy: true,
              canDrop: true,
              checked: false,
              childCommitIds: [],
            },
            {
              commitId: 'stuck',
              commitPrefix: 's',
              description: '',
              timestamp: '',
              isWorkingCopy: false,
              canDrop: false,
              checked: false,
              childCommitIds: ['immutable-child'],
            },
            {
              commitId: 'drop',
              commitPrefix: 'd',
              description: '',
              timestamp: '',
              isWorkingCopy: false,
              canDrop: true,
              checked: true,
              childCommitIds: ['kid', 'keep'],
            },
          ],
        },
      ],
    }

    expect(
      cleanupSteps(snapshot, {
        bookmarks: ['landed', 'missing'],
        workspaces: ['old'],
        divergent: ['drop', 'stuck'],
      }),
    ).toEqual([
      { kind: 'forgetBookmark', name: 'landed' },
      { kind: 'rebase', revset: 'kid', onto: 'keep' },
      { kind: 'abandon', commitId: 'drop' },
      { kind: 'forgetWorkspace', name: 'old' },
    ])
  })
})
