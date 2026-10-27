import { describe, expect, test } from 'vitest'
import { resolveSelectedCommit, type SelectedChange } from '../../src/repo/selection'

function commit(commitId: string, changeId: string) {
  return { commitId, changeId }
}

const selected: SelectedChange = { repoId: '/repo', commitId: 'c1', changeId: 'change' }

describe('resolveSelectedCommit', () => {
  test('keeps the selected commit when the change is divergent', () => {
    const commits = [commit('c1', 'change'), commit('c2', 'change')]

    expect(resolveSelectedCommit(commits, selected, '/repo')?.commitId).toBe('c1')
    expect(resolveSelectedCommit(commits, { ...selected, commitId: 'c2' }, '/repo')?.commitId).toBe(
      'c2',
    )
  })

  test('follows a rewritten change when one commit remains', () => {
    expect(resolveSelectedCommit([commit('c3', 'change')], selected, '/repo')?.commitId).toBe('c3')
  })

  test('does not guess when the selected commit is gone and the change is still divergent', () => {
    const commits = [commit('c3', 'change'), commit('c4', 'change')]

    expect(resolveSelectedCommit(commits, selected, '/repo')).toBeNull()
  })

  test('ignores a selection from another repository', () => {
    expect(resolveSelectedCommit([commit('c1', 'change')], selected, '/other')).toBeNull()
  })

  test('counts a commit that is in both lists once', () => {
    const only = commit('c3', 'change')

    expect(resolveSelectedCommit([only, only], selected, '/repo')).toEqual(only)
  })
})
