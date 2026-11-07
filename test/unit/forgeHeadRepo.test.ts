import { describe, expect, test } from 'vitest'
import { GithubClient } from '../../src/forge/github'
import { GitlabClient } from '../../src/forge/gitlab'
import type { HttpFetch } from '../../src/forge/types'

function fakeFetch(responses: Record<string, unknown>): HttpFetch {
  return async (url) => {
    const key = Object.keys(responses).find((k) => url.includes(k))
    if (!key) {
      return new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
    }
    return new Response(JSON.stringify(responses[key]), { status: 200 })
  }
}

function pull(
  number: number,
  head: string,
  fork: { owner: string } | null,
): Record<string, unknown> {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    state: 'OPEN',
    isDraft: false,
    headRefName: head,
    baseRefName: 'main',
    isCrossRepository: fork !== null,
    headRepositoryOwner: { login: fork?.owner ?? 'o' },
    author: { login: fork?.owner ?? 'ada' },
    reviewDecision: null,
    latestReviews: { totalCount: 0 },
    commits: { nodes: [] },
  }
}

function githubList(pulls: readonly Record<string, unknown>[]): unknown {
  return { data: { viewer: { login: 'Sam' }, repository: { pullRequests: { nodes: pulls } } } }
}

describe('GitHub requests from forks', () => {
  test('keeps requests from the repository and from the viewer own fork only', async () => {
    const client = new GithubClient(
      'github.com',
      'o/r',
      't',
      fakeFetch({
        graphql: githubList([
          pull(1, 'main', { owner: 'stranger' }),
          pull(2, 'fix', null),
          pull(3, 'feat', { owner: 'sam' }),
        ]),
      }),
    )

    const requests = await client.listRequests(['main', 'fix', 'feat'])

    expect(requests.map((request) => request.number)).toEqual([2, 3])
  })

  test('drops a request whose fork was deleted', async () => {
    const deleted = { ...pull(4, 'fix', { owner: 'gone' }), headRepositoryOwner: null }
    const client = new GithubClient(
      'github.com',
      'o/r',
      't',
      fakeFetch({ graphql: githubList([deleted]) }),
    )

    await expect(client.listRequests(['fix'])).resolves.toEqual([])
  })
})

function mergeRequest(
  iid: number,
  branch: string,
  sourceProject: number,
  author: number,
): Record<string, unknown> {
  return {
    iid,
    title: `MR ${iid}`,
    web_url: `https://gitlab.com/a/b/-/merge_requests/${iid}`,
    state: 'merged',
    source_branch: branch,
    target_branch: 'main',
    source_project_id: sourceProject,
    target_project_id: 1,
    author: { id: author },
  }
}

describe('GitLab requests from forks', () => {
  test('keeps requests from the project and the user own forks only', async () => {
    const client = new GitlabClient(
      'gitlab.com',
      'a/b',
      't',
      fakeFetch({
        '/api/v4/user': { id: 5 },
        '/merge_requests?': [
          mergeRequest(1, 'main', 77, 9),
          mergeRequest(2, 'fix', 1, 9),
          mergeRequest(3, 'feat', 78, 5),
        ],
      }),
    )

    const requests = await client.listRequests(['main', 'fix', 'feat'])

    expect(requests.map((request) => request.number)).toEqual([2, 3])
  })

  test('keeps a request when GitLab leaves out the project ids', async () => {
    const listed = { ...mergeRequest(6, 'fix', 77, 9), source_project_id: undefined }
    const client = new GitlabClient(
      'gitlab.com',
      'a/b',
      't',
      fakeFetch({ '/api/v4/user': { id: 5 }, '/merge_requests?': [listed] }),
    )

    const requests = await client.listRequests(['fix'])

    expect(requests.map((request) => request.number)).toEqual([6])
  })
})
