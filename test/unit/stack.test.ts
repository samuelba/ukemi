import { describe, expect, test } from 'vitest'
import type { RequestBadge, RequestState } from '../../shared/protocol'
import { buildStacks, stackLabel, stackOf, withStackInfo } from '../../shared/stack'
import { deadBranchesOf, expectedBase, withBases } from '../../src/forge/stackSync'

function request(
  number: number,
  head: string,
  base: string,
  state: RequestState = 'open',
): RequestBadge {
  return {
    number,
    title: `PR ${number}`,
    url: `https://example.com/${number}`,
    state,
    ci: 'none',
    isMine: true,
    checks: [],
    headBranch: head,
    baseBranch: base,
  }
}

describe('buildStacks', () => {
  test('chains requests bottom first', () => {
    const chains = buildStacks([
      request(3, 'c', 'b'),
      request(1, 'a', 'main'),
      request(2, 'b', 'a'),
    ])

    expect(chains.map((chain) => chain.map((r) => r.number))).toEqual([[1, 2, 3]])
  })

  test('ignores merged and closed requests', () => {
    const chains = buildStacks([
      request(1, 'a', 'main', 'merged'),
      request(2, 'b', 'a'),
      request(3, 'c', 'b'),
      request(4, 'd', 'c', 'closed'),
    ])

    expect(chains.map((chain) => chain.map((r) => r.number))).toEqual([[2, 3]])
  })

  test('splits a branching stack into linear chains', () => {
    const chains = buildStacks([
      request(1, 'a', 'main'),
      request(2, 'b', 'a'),
      request(3, 'c', 'a'),
      request(4, 'd', 'b'),
    ])

    expect(chains.map((chain) => chain.map((r) => r.number)).sort()).toEqual([[1], [2, 4], [3]])
  })

  test('does not loop on cycles or self references', () => {
    expect(buildStacks([request(1, 'a', 'b'), request(2, 'b', 'a')])).toEqual([])
    expect(buildStacks([request(1, 'a', 'a')]).map((chain) => chain.length)).toEqual([1])
  })
})

describe('withStackInfo', () => {
  test('numbers stacks of two or more and leaves single requests alone', () => {
    const result = withStackInfo([
      request(1, 'a', 'main'),
      request(2, 'b', 'a'),
      request(3, 'c', 'b'),
      request(9, 'solo', 'main'),
    ])

    expect(result.map((r) => r.stack)).toEqual([
      { position: 1, size: 3 },
      { position: 2, size: 3 },
      { position: 3, size: 3 },
      undefined,
    ])
    expect(stackLabel(result[1]?.stack)).toBe('2/3')
    expect(stackLabel(result[3]?.stack)).toBeNull()
  })

  test('drops stale stack info', () => {
    const [stale] = withStackInfo([{ ...request(1, 'a', 'main'), stack: { position: 1, size: 5 } }])

    expect(stale?.stack).toBeUndefined()
  })
})

describe('stackOf', () => {
  test('returns the chain that contains a request', () => {
    const requests = [request(1, 'a', 'main'), request(2, 'b', 'a'), request(5, 'x', 'main')]

    expect(stackOf(requests, 2).map((r) => r.number)).toEqual([1, 2])
    expect(stackOf(requests, 404)).toEqual([])
  })
})

describe('expectedBase', () => {
  const base = {
    trunk: 'main',
    ancestorBookmarks: new Set<string>(),
    deadBranches: new Set<string>(),
  }

  test('keeps a base that is still the nearest parent request', () => {
    expect(expectedBase({ ...base, current: 'a', parentCandidates: ['a'] })).toBe('a')
  })

  test('stacks a request on the nearest parent request when it targets the trunk', () => {
    expect(expectedBase({ ...base, current: 'main', parentCandidates: ['b'] })).toBe('b')
  })

  test('retargets to the trunk when the parent request is merged', () => {
    expect(
      expectedBase({
        ...base,
        current: 'a',
        parentCandidates: [],
        deadBranches: new Set(['a']),
      }),
    ).toBe('main')
  })

  test('moves onto the new parent when the old base is gone', () => {
    expect(
      expectedBase({
        ...base,
        current: 'a',
        parentCandidates: ['b'],
        deadBranches: new Set(['a']),
      }),
    ).toBe('b')
  })

  test('keeps a branch chosen on purpose', () => {
    expect(expectedBase({ ...base, current: 'release', parentCandidates: ['b'] })).toBe('release')
    expect(expectedBase({ ...base, current: 'release', parentCandidates: [] })).toBe('release')
  })

  test('keeps an ancestor bookmark that has no request', () => {
    expect(
      expectedBase({
        ...base,
        current: 'wip',
        parentCandidates: [],
        ancestorBookmarks: new Set(['wip']),
      }),
    ).toBe('wip')
  })
})

describe('stack sync helpers', () => {
  test('finds branches whose requests are all finished', () => {
    const dead = deadBranchesOf([
      request(1, 'a', 'main', 'merged'),
      request(2, 'b', 'main', 'closed'),
      request(3, 'b', 'main'),
    ])

    expect([...dead]).toEqual(['a'])
  })

  test('applies planned base changes', () => {
    const [changed, same] = withBases(
      [request(1, 'a', 'main'), request(2, 'b', 'a')],
      [{ number: 1, from: 'main', to: 'x' }],
    )

    expect(changed?.baseBranch).toBe('x')
    expect(same?.baseBranch).toBe('a')
  })
})
