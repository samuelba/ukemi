import { describe, expect, test } from 'vitest'
import { parseWorkspaces } from '../../src/jj/parse'
import {
  defaultWorkspaceName,
  isWorkspaceOpen,
  suggestedWorkspaceName,
  workspaceBaseItems,
  workspaceContextValue,
  workspaceItemDescription,
  workspaceItemLabel,
  workspaceNesting,
  type CommitBookmarks,
} from '../../src/repo/workspaceItems'
import type { Workspace } from '../../shared/model'

const workspace = (overrides: Partial<Workspace> = {}): Workspace => ({
  name: 'agent',
  root: '/work/repo-agent',
  commitId: 'a'.repeat(40),
  changeId: 'yltuvvqk',
  description: 'fix the gate',
  isEmpty: false,
  changedFiles: 2,
  ...overrides,
})

describe('parseWorkspaces', () => {
  test('reads the change id, description and file count', () => {
    const output = [
      '{"name":"default","root":"/repo","commit_id":"abc","change_id":"yltuvvqk","description":"say \\"hi\\"","is_empty":false,"changed_files":2}',
      '{"name":"other","root":null,"commit_id":"def","change_id":"mwlmtqvr","description":"","is_empty":true,"changed_files":0}',
    ].join('\n')

    expect(parseWorkspaces(output)).toEqual([
      {
        name: 'default',
        root: '/repo',
        commitId: 'abc',
        changeId: 'yltuvvqk',
        description: 'say "hi"',
        isEmpty: false,
        changedFiles: 2,
      },
      {
        name: 'other',
        root: null,
        commitId: 'def',
        changeId: 'mwlmtqvr',
        description: '',
        isEmpty: true,
        changedFiles: 0,
      },
    ])
  })
})

describe('workspace tree text', () => {
  test('marks the current workspace and shows an empty change', () => {
    expect(workspaceItemLabel('default', true)).toBe('default (current)')
    expect(workspaceItemLabel('agent', false)).toBe('agent')
    expect(workspaceItemDescription(workspace({ isEmpty: true, description: '' }))).toBe('(empty)')
  })

  test('shows the short change id and the first description line', () => {
    expect(workspaceItemDescription(workspace())).toBe('yltuvvqk fix the gate')
  })

  test('encodes open, current and default in the context value', () => {
    expect(
      workspaceContextValue({
        isCurrent: true,
        isOpen: true,
        isDefault: true,
        hasRoot: true,
      }),
    ).toBe('workspace+default+current+open')
    expect(
      workspaceContextValue({
        isCurrent: false,
        isOpen: false,
        isDefault: false,
        hasRoot: false,
      }),
    ).toBe('workspace+missing')
  })
})

describe('workspace nesting', () => {
  test('detects a workspace inside an open folder and the reverse', () => {
    expect(workspaceNesting('/work/repo-agent', ['/work'])).toBe('inside')
    expect(workspaceNesting('/work', ['/work/repo'])).toBe('contains')
    expect(workspaceNesting('/work/repo', ['/work/repo'])).toBeNull()
    expect(workspaceNesting('/other', ['/work/repo'])).toBeNull()
  })

  test('treats only an exact folder match as already open', () => {
    expect(isWorkspaceOpen('/work/repo', ['/work/repo'])).toBe(true)
    expect(isWorkspaceOpen('/work/repo', ['/work'])).toBe(false)
  })
})

describe('workspace names', () => {
  test('derives a name from a bookmark, a remote bookmark or a change id', () => {
    expect(defaultWorkspaceName('feature')).toBe('feature')
    expect(defaultWorkspaceName('feature@origin')).toBe('feature')
    expect(defaultWorkspaceName('a'.repeat(40))).toBe('aaaaaaaa')
    expect(defaultWorkspaceName('@')).toBe('')
    expect(defaultWorkspaceName('trunk()')).toBe('')
  })

  test('prefers a bookmark on the commit, then the short change id', () => {
    const commit = {
      changeId: '1234abcd5678',
      changePrefix: '1234',
      localBookmarks: [{ name: 'feature' }],
    }
    expect(suggestedWorkspaceName(commit.changeId, commit)).toBe('feature')
    expect(
      suggestedWorkspaceName('ignored', { ...commit, localBookmarks: [] }),
    ).toBe('1234abcd')
  })
})

describe('workspaceBaseItems', () => {
  test('offers trunk, the working copy, then local and remote bookmarks', () => {
    const commits: CommitBookmarks[] = [
      {
        commitId: 'abc',
        localBookmarks: [{ name: 'feature' }],
        remoteBookmarks: [{ name: 'main', remote: 'origin' }],
      },
    ]

    expect(workspaceBaseItems({ trunkName: 'main', commits }).map((item) => item.revision)).toEqual(
      ['trunk()', '@', 'feature', 'main@origin'],
    )
    expect(workspaceBaseItems({ trunkName: 'main', commits })[0]?.suggestedName).toBe('main')
    expect(workspaceBaseItems({ trunkName: null, commits })[0]?.revision).toBe('@')
  })
})
