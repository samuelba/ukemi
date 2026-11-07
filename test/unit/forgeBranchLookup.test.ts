import { describe, expect, test } from 'vitest'
import { branchQuery, GithubClient } from '../../src/forge/github'
import { GitlabClient } from '../../src/forge/gitlab'
import type { HttpFetch } from '../../src/forge/types'

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function pull(number: number, head: string): Record<string, unknown> {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    state: 'OPEN',
    isDraft: false,
    headRefName: head,
    baseRefName: 'main',
    isCrossRepository: false,
    headRepositoryOwner: { login: 'o' },
    author: { login: 'sam' },
    reviewDecision: null,
    latestReviews: { totalCount: 0 },
    commits: { nodes: [] },
  }
}

interface GraphqlCall {
  query: string
  variables: Record<string, string>
}

// Answers each aliased lookup with the pulls listed for its branch.
function githubFake(byBranch: Record<string, readonly number[]>, calls: GraphqlCall[]): HttpFetch {
  return async (_url, init) => {
    const request = JSON.parse(String(init.body)) as GraphqlCall
    calls.push(request)
    const repository = Object.fromEntries(
      Object.entries(request.variables)
        .filter(([key]) => /^b\d+$/.test(key))
        .map(([key, branch]) => [
          key,
          { nodes: (byBranch[branch] ?? []).map((number) => pull(number, branch)) },
        ]),
    )
    return json({ data: { viewer: { login: 'sam' }, repository } })
  }
}

describe('GitHub lookup by head branch', () => {
  test('asks for every branch by name, twenty per query', async () => {
    const calls: GraphqlCall[] = []
    const branches = Array.from({ length: 45 }, (_, index) => `topic-${index}`)
    const client = new GithubClient(
      'github.com',
      'o/r',
      't',
      githubFake({ 'topic-44': [7] }, calls),
    )

    const requests = await client.listRequests(branches, 500)

    expect(calls.map((call) => Object.keys(call.variables).length - 2)).toEqual([20, 20, 5])
    expect(calls[2]?.variables.b4).toBe('topic-44')
    expect(requests.map((request) => request.number)).toEqual([7])
  })

  test('looks up only as many branches as the limit allows', async () => {
    const calls: GraphqlCall[] = []
    const client = new GithubClient('github.com', 'o/r', 't', githubFake({}, calls))

    await client.listRequests(['a', 'b', 'c', 'a'], 2)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.variables).toMatchObject({ b0: 'a', b1: 'b' })
    expect(calls[0]?.variables).not.toHaveProperty('b2')
  })

  test('sends nothing without branches', async () => {
    const calls: GraphqlCall[] = []
    const client = new GithubClient('github.com', 'o/r', 't', githubFake({}, calls))

    await expect(client.listRequests([])).resolves.toEqual([])
    expect(calls).toHaveLength(0)
  })

  test('builds one aliased lookup per branch', () => {
    const query = branchQuery(2)

    expect(query).toContain('$b0: String!, $b1: String!')
    expect(query).toContain('b1: pullRequests(headRefName: $b1, first: 10')
    expect(query).toContain('fragment PullFields on PullRequest')
  })
})

function mergeRequest(iid: number, branch: string): Record<string, unknown> {
  return {
    iid,
    title: `MR ${iid}`,
    web_url: `https://gitlab.com/a/b/-/merge_requests/${iid}`,
    state: 'merged',
    source_branch: branch,
    target_branch: 'main',
    author: { id: 1 },
  }
}

describe('GitLab lookup by head branch', () => {
  test('asks for each branch by name and lists a request once', async () => {
    const asked: string[] = []
    const client = new GitlabClient('gitlab.com', 'a/b', 't', async (url) => {
      if (url.includes('/api/v4/user')) {
        return json({ id: 1 })
      }
      const branch = new URL(url).searchParams.get('source_branch') ?? ''
      asked.push(branch)
      return json(branch === 'feat/one' ? [mergeRequest(3, 'feat/one')] : [])
    })

    const requests = await client.listRequests(['feat/one', 'b', 'feat/one'])

    expect(asked.sort()).toEqual(['b', 'feat/one'])
    expect(requests.map((request) => request.number)).toEqual([3])
  })

  test('encodes the branch name in the URL', async () => {
    const urls: string[] = []
    const client = new GitlabClient('gitlab.com', 'a/b', 't', async (url) => {
      urls.push(url)
      return json(url.includes('/api/v4/user') ? { id: 1 } : [])
    })

    await client.listRequests(['fix&state=opened'])

    expect(urls.some((url) => url.includes('source_branch=fix%26state%3Dopened'))).toBe(true)
  })

  test('looks up only as many branches as the limit allows', async () => {
    const asked: string[] = []
    const client = new GitlabClient('gitlab.com', 'a/b', 't', async (url) => {
      if (!url.includes('/api/v4/user')) {
        asked.push(new URL(url).searchParams.get('source_branch') ?? '')
      }
      return json(url.includes('/api/v4/user') ? { id: 1 } : [])
    })

    await client.listRequests(['a', 'b', 'c'], 2)

    expect(asked.sort()).toEqual(['a', 'b'])
  })

  test('sends nothing without branches', async () => {
    let calls = 0
    const client = new GitlabClient('gitlab.com', 'a/b', 't', async () => {
      calls += 1
      return json([])
    })

    await expect(client.listRequests([])).resolves.toEqual([])
    expect(calls).toBe(0)
  })
})
