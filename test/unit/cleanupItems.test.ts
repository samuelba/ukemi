import { describe, expect, test } from 'vitest'
import type { CleanupSelection, CleanupSnapshot } from '../../shared/cleanup'
import {
  classifyBookmarks,
  classifyDeletedBookmarks,
  classifyDivergent,
  classifyUndescribed,
  classifyWorkspaces,
  cleanupSteps,
  forgottenWorkspaceRoots,
  type BookmarkRecord,
  type DivergentCommit,
  type UndescribedCommit,
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
    root: '/tmp/ukemi-other',
    ...overrides,
  }
}

const REPO_ROOT = '/repo'

function undescribed(overrides: Partial<UndescribedCommit> = {}): UndescribedCommit {
  return {
    changePrefix: 'abc',
    commitId: 'a'.repeat(40),
    commitPrefix: 'aaaa',
    description: '',
    timestamp: '2026-01-01T00:00:00Z',
    isWorkingCopy: false,
    isEmpty: false,
    isImmutable: false,
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
        hasGitRemote: false,
        abandonCommitIds: [],
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
      hasGitRemote: true,
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
        hasGitRemote: false,
        abandonCommitIds: [],
      },
    ])
  })
})

describe('classifyDeletedBookmarks', () => {
  test('offers a push for a deleted local bookmark that still tracks a remote', () => {
    const rows = [
      local('topic', { present: false }),
      remote('topic', 'git'),
      remote('topic', 'origin'),
      local('solo', { present: false }),
      local('kept'),
    ]

    expect(classifyDeletedBookmarks(rows)).toEqual([
      {
        name: 'solo',
        remotes: [],
        detail: 'No remote bookmark.',
        checked: true,
        canDeleteRemote: false,
      },
      {
        name: 'topic',
        remotes: ['origin'],
        detail: 'Push deletes topic@origin.',
        checked: true,
        canDeleteRemote: true,
      },
    ])
  })

  test('ignores a tracked remote that is already gone', () => {
    const rows = [local('topic', { present: false }), remote('topic', 'origin', { present: false })]

    expect(classifyDeletedBookmarks(rows)).toEqual([
      {
        name: 'topic',
        remotes: [],
        detail: 'No remote bookmark.',
        checked: true,
        canDeleteRemote: false,
      },
    ])
  })
})

describe('classifyUndescribed', () => {
  test('keeps blank commits and drops the working copy, described commits, and the root', () => {
    const blank = undescribed()
    const later = undescribed({
      commitId: 'b'.repeat(40),
      changePrefix: 'bbb',
      commitPrefix: 'bbbb',
      description: '  \nnotes',
      isEmpty: true,
    })

    expect(
      classifyUndescribed([
        undescribed({ isWorkingCopy: true }),
        blank,
        undescribed({ commitId: 'c'.repeat(40), description: 'done' }),
        undescribed({ commitId: '0'.repeat(40) }),
        later,
      ]),
    ).toEqual([
      {
        commitId: blank.commitId,
        changePrefix: 'abc',
        commitPrefix: 'aaaa',
        timestamp: '2026-01-01T00:00:00Z',
        isEmpty: false,
        isImmutable: false,
        canAbandon: true,
      },
      {
        commitId: later.commitId,
        changePrefix: 'bbb',
        commitPrefix: 'bbbb',
        timestamp: '2026-01-01T00:00:00Z',
        isEmpty: true,
        isImmutable: false,
        canAbandon: true,
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

    expect(classifyWorkspaces(rows, REPO_ROOT)).toEqual([
      {
        name: 'gone',
        detail: 'Working copy folder is missing.',
        checked: true,
        root: '/tmp/ukemi-other',
        canDeleteFiles: false,
      },
      {
        name: 'kept',
        detail: 'still working',
        checked: false,
        root: '/tmp/ukemi-other',
        canDeleteFiles: true,
      },
    ])
  })

  test('marks an empty workspace', () => {
    expect(classifyWorkspaces([workspace({ isEmpty: true, description: '' })], REPO_ROOT)).toEqual([
      {
        name: 'other',
        detail: '(empty)',
        checked: false,
        root: '/tmp/ukemi-other',
        canDeleteFiles: true,
      },
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

function selection(overrides: Partial<CleanupSelection> = {}): CleanupSelection {
  return {
    bookmarks: [],
    abandonBookmarkCommits: [],
    deletedBookmarks: [],
    deleteRemote: [],
    workspaces: [],
    deleteWorkspaceFiles: [],
    divergent: [],
    undescribed: [],
    ...overrides,
  }
}

function bookmark(
  name: string,
  overrides: Partial<CleanupSnapshot['bookmarks'][number]> = {},
): CleanupSnapshot['bookmarks'][number] {
  return {
    name,
    reason: 'merged',
    detail: '',
    description: '',
    checked: true,
    hasGitRemote: false,
    abandonCommitIds: [],
    ...overrides,
  }
}

describe('cleanupSteps', () => {
  test('forgets bookmarks, rebases children, abandons drops, then forgets workspaces', () => {
    const snapshot: CleanupSnapshot = {
      bookmarks: [bookmark('landed', { hasGitRemote: true })],
      deletedBookmarks: [],
      workspaces: [
        { name: 'old', detail: '', checked: true, root: '/tmp/old', canDeleteFiles: true },
      ],
      undescribed: [],
      undescribedTruncated: false,
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
      cleanupSteps(
        snapshot,
        selection({
          bookmarks: ['landed', 'missing'],
          workspaces: ['old'],
          divergent: ['drop', 'stuck'],
        }),
      ),
    ).toEqual([
      { kind: 'forgetBookmark', name: 'landed', includeGit: true },
      { kind: 'rebase', revset: 'kid', onto: 'keep' },
      { kind: 'abandon', revset: 'drop' },
      { kind: 'forgetWorkspace', name: 'old' },
    ])
  })

  test('pushes a deleted bookmark and forgets one that cannot delete the remote', () => {
    const snapshot: CleanupSnapshot = {
      bookmarks: [bookmark('landed')],
      deletedBookmarks: [
        {
          name: 'topic',
          remotes: ['origin'],
          detail: 'Push deletes topic@origin.',
          checked: true,
          canDeleteRemote: true,
        },
        {
          name: 'gone',
          remotes: [],
          detail: 'No remote bookmark.',
          checked: true,
          canDeleteRemote: false,
        },
      ],
      workspaces: [],
      divergent: [],
      undescribed: [],
      undescribedTruncated: false,
    }

    expect(
      cleanupSteps(
        snapshot,
        selection({
          bookmarks: ['landed'],
          deletedBookmarks: ['topic', 'gone', 'missing'],
          deleteRemote: ['topic', 'gone'],
        }),
      ),
    ).toEqual([
      { kind: 'pushDeletedBookmark', name: 'topic' },
      { kind: 'forgetBookmark', name: 'landed', includeGit: false },
      { kind: 'forgetBookmark', name: 'gone', includeGit: false },
    ])
  })

  test('forgets a deleted bookmark when the remote is kept', () => {
    const snapshot: CleanupSnapshot = {
      bookmarks: [],
      deletedBookmarks: [
        {
          name: 'topic',
          remotes: ['origin'],
          detail: 'Push deletes topic@origin.',
          checked: true,
          canDeleteRemote: true,
        },
      ],
      workspaces: [],
      divergent: [],
      undescribed: [],
      undescribedTruncated: false,
    }

    expect(cleanupSteps(snapshot, selection({ deletedBookmarks: ['topic'] }))).toEqual([
      { kind: 'forgetBookmark', name: 'topic', includeGit: false },
    ])
  })

  test("abandons a bookmark's commits before forgetting it", () => {
    const snapshot: CleanupSnapshot = {
      bookmarks: [
        bookmark('topic', { reason: 'deleted-remote', abandonCommitIds: ['aaa', 'bbb'] }),
      ],
      deletedBookmarks: [],
      workspaces: [],
      divergent: [],
      undescribed: [],
      undescribedTruncated: false,
    }

    expect(
      cleanupSteps(
        snapshot,
        selection({ bookmarks: ['topic'], abandonBookmarkCommits: ['topic'] }),
      ),
    ).toEqual([
      { kind: 'abandon', revset: 'aaa|bbb' },
      { kind: 'forgetBookmark', name: 'topic', includeGit: false },
    ])
  })

  test('skips bookmark abandon when the bookmark itself is not selected', () => {
    const snapshot: CleanupSnapshot = {
      bookmarks: [bookmark('topic', { abandonCommitIds: ['aaa'] })],
      deletedBookmarks: [],
      workspaces: [],
      divergent: [],
      undescribed: [],
      undescribedTruncated: false,
    }

    expect(cleanupSteps(snapshot, selection({ abandonBookmarkCommits: ['topic'] }))).toEqual([])
  })

  test('abandons checked commits that have no description', () => {
    const snapshot: CleanupSnapshot = {
      bookmarks: [],
      deletedBookmarks: [],
      workspaces: [],
      divergent: [],
      undescribed: [
        {
          commitId: 'empty',
          changePrefix: 'emp',
          commitPrefix: 'eee',
          timestamp: '',
          isEmpty: true,
          isImmutable: false,
          canAbandon: true,
        },
        {
          commitId: 'stuck',
          changePrefix: 'stu',
          commitPrefix: 'sss',
          timestamp: '',
          isEmpty: false,
          isImmutable: true,
          canAbandon: false,
        },
      ],
      undescribedTruncated: false,
    }

    expect(cleanupSteps(snapshot, selection({ undescribed: ['empty', 'stuck'] }))).toEqual([
      { kind: 'abandon', revset: 'empty' },
    ])
  })

  test('deletes a workspace folder only when that box is checked', () => {
    const snapshot: CleanupSnapshot = {
      bookmarks: [],
      deletedBookmarks: [],
      workspaces: [
        { name: 'kept', detail: '', checked: true, root: '/tmp/kept', canDeleteFiles: true },
        { name: 'removed', detail: '', checked: true, root: '/tmp/removed', canDeleteFiles: true },
        { name: 'missing', detail: '', checked: true, root: null, canDeleteFiles: false },
      ],
      divergent: [],
      undescribed: [],
      undescribedTruncated: false,
    }

    expect(
      cleanupSteps(
        snapshot,
        selection({
          workspaces: ['kept', 'removed', 'missing'],
          deleteWorkspaceFiles: ['removed', 'missing'],
        }),
      ),
    ).toEqual([
      { kind: 'forgetWorkspace', name: 'kept' },
      { kind: 'forgetWorkspace', name: 'removed' },
      { kind: 'forgetWorkspace', name: 'missing' },
      { kind: 'deleteWorkspaceFiles', root: '/tmp/removed' },
    ])
  })
})

describe('forgottenWorkspaceRoots', () => {
  const snapshot: CleanupSnapshot = {
    bookmarks: [],
    deletedBookmarks: [],
    workspaces: [
      { name: 'kept', detail: '', checked: true, root: '/tmp/kept', canDeleteFiles: true },
      { name: 'removed', detail: '', checked: true, root: '/tmp/removed', canDeleteFiles: true },
      { name: 'here', detail: '', checked: true, root: '/tmp/repo', canDeleteFiles: false },
      { name: 'missing', detail: '', checked: true, root: null, canDeleteFiles: false },
    ],
    divergent: [],
    undescribed: [],
    undescribedTruncated: false,
  }

  test('returns selected workspace roots other than the active one', () => {
    expect(
      forgottenWorkspaceRoots(
        snapshot,
        selection({ workspaces: ['kept', 'removed', 'here', 'missing'] }),
        '/tmp/repo',
      ),
    ).toEqual(['/tmp/kept', '/tmp/removed'])
  })

  test('skips a workspace that was not selected', () => {
    expect(
      forgottenWorkspaceRoots(snapshot, selection({ workspaces: ['removed'] }), '/tmp/repo'),
    ).toEqual(['/tmp/removed'])
  })
})
