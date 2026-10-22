import { describe, expect, test } from 'vitest'
import { detectForge, forgeKindForHost } from '../../src/forge/detect'
import { GithubClient, githubCi, githubState } from '../../src/forge/github'
import { GitlabClient, gitlabCi, gitlabState } from '../../src/forge/gitlab'
import { parseRemoteUrl } from '../../src/forge/remoteUrl'
import { ForgeError, type HttpFetch } from '../../src/forge/types'

describe('parseRemoteUrl', () => {
  test.each([
    ['https://github.com/owner/repo.git', 'github.com', 'owner/repo'],
    ['git@github.com:owner/repo.git', 'github.com', 'owner/repo'],
    ['ssh://git@git.anybotics.com:2222/group/sub/repo.git', 'git.anybotics.com', 'group/sub/repo'],
    ['https://user@gitlab.com/group/repo/', 'gitlab.com', 'group/repo'],
  ])('parses %s', (url, host, projectPath) => {
    expect(parseRemoteUrl(url)).toEqual({ host, projectPath })
  })

  test('rejects local paths and single-segment paths', () => {
    expect(parseRemoteUrl('/tmp/remote.git')).toBeNull()
    expect(parseRemoteUrl('file:///tmp/remote.git')).toBeNull()
    expect(parseRemoteUrl('https://example.com/repo.git')).toBeNull()
  })
})

describe('forge detection', () => {
  const lists = { gitlabHosts: ['git.anybotics.com'], githubHosts: [] }

  test('detects known and configured hosts', () => {
    expect(forgeKindForHost('github.com', lists)).toBe('github')
    expect(forgeKindForHost('gitlab.example.org', lists)).toBe('gitlab')
    expect(forgeKindForHost('git.anybotics.com', lists)).toBe('gitlab')
    expect(forgeKindForHost('bitbucket.org', lists)).toBeNull()
  })

  test('prefers the origin remote', () => {
    const remotes = [
      { name: 'fork', url: 'git@github.com:me/repo.git' },
      { name: 'origin', url: 'https://git.anybotics.com/team/repo.git' },
    ]

    expect(detectForge(remotes, lists)).toEqual({
      kind: 'gitlab',
      host: 'git.anybotics.com',
      projectPath: 'team/repo',
      remote: 'origin',
    })
  })
})

describe('request state mapping', () => {
  test('maps GitHub pull request states', () => {
    const base = {
      state: 'OPEN' as const,
      isDraft: false,
      reviewDecision: null,
      latestReviews: { totalCount: 0 },
    }
    expect(githubState(base)).toBe('open')
    expect(githubState({ ...base, isDraft: true })).toBe('draft')
    expect(githubState({ ...base, latestReviews: { totalCount: 2 } })).toBe('reviewed')
    expect(githubState({ ...base, reviewDecision: 'APPROVED' })).toBe('approved')
    expect(githubState({ ...base, state: 'MERGED' })).toBe('merged')
    expect(githubCi('FAILURE')).toBe('failure')
    expect(githubCi(undefined)).toBe('none')
  })

  test('maps GitLab merge request states', () => {
    expect(gitlabState({ state: 'opened' }, null)).toBe('open')
    expect(gitlabState({ state: 'opened', draft: true }, null)).toBe('draft')
    expect(gitlabState({ state: 'opened' }, { approved: false, approvalCount: 1 })).toBe('reviewed')
    expect(gitlabState({ state: 'opened' }, { approved: true, approvalCount: 1 })).toBe('approved')
    expect(gitlabState({ state: 'merged' }, null)).toBe('merged')
    expect(gitlabCi('running')).toBe('pending')
    expect(gitlabCi('success')).toBe('success')
  })
})

function fakeFetch(responses: Record<string, unknown>, calls: string[] = []): HttpFetch {
  return async (url, init) => {
    calls.push(`${init.method ?? 'GET'} ${url}`)
    const key = Object.keys(responses).find((k) => url.includes(k))
    if (!key) {
      return new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
    }
    return new Response(JSON.stringify(responses[key]), { status: 200 })
  }
}

describe('GithubClient', () => {
  test('lists pull requests for local branches only', async () => {
    const node = (number: number, head: string) => ({
      number,
      title: `PR ${number}`,
      url: `https://github.com/o/r/pull/${number}`,
      state: 'OPEN',
      isDraft: false,
      headRefName: head,
      baseRefName: 'main',
      reviewDecision: null,
      latestReviews: { totalCount: 0 },
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
    })
    const client = new GithubClient(
      'github.com',
      'o/r',
      'token',
      fakeFetch({
        graphql: {
          data: { repository: { pullRequests: { nodes: [node(1, 'mine'), node(2, 'other')] } } },
        },
      }),
    )

    const requests = await client.listRequests(['mine'])

    expect(requests).toEqual([
      {
        number: 1,
        title: 'PR 1',
        url: 'https://github.com/o/r/pull/1',
        state: 'open',
        ci: 'success',
        headBranch: 'mine',
        baseBranch: 'main',
      },
    ])
  })

  test('uses the enterprise API base for other hosts', async () => {
    const calls: string[] = []
    const client = new GithubClient(
      'ghe.corp',
      'o/r',
      't',
      fakeFetch(
        {
          '/pulls': {
            number: 5,
            title: 't',
            html_url: 'u',
            draft: true,
            head: { ref: 'h' },
            base: { ref: 'b' },
          },
        },
        calls,
      ),
    )

    const created = await client.createRequest({
      head: 'h',
      base: 'b',
      title: 't',
      body: '',
      isDraft: true,
    })

    expect(calls).toEqual(['POST https://ghe.corp/api/v3/repos/o/r/pulls'])
    expect(created.state).toBe('draft')
  })
})

describe('GitlabClient', () => {
  test('lists merge requests with pipeline and approval details', async () => {
    const calls: string[] = []
    const client = new GitlabClient(
      'git.anybotics.com',
      'team/sub/repo',
      't',
      fakeFetch(
        {
          '/merge_requests/7/approvals': { approved: true, approved_by: [{}] },
          '/merge_requests/7': { head_pipeline: { status: 'failed' } },
          '/merge_requests?': [
            {
              iid: 7,
              title: 'MR',
              web_url: 'w',
              state: 'opened',
              draft: false,
              source_branch: 'feat',
              target_branch: 'main',
            },
          ],
        },
        calls,
      ),
    )

    const [mr] = await client.listRequests(['feat'])

    expect(calls[0]).toContain('/api/v4/projects/team%2Fsub%2Frepo/merge_requests?state=all')
    expect(mr).toMatchObject({ number: 7, state: 'approved', ci: 'failure' })
  })

  test('surfaces API errors with the status code', async () => {
    const client = new GitlabClient(
      'gitlab.com',
      'a/b',
      't',
      async () => new Response(JSON.stringify({ message: '401 Unauthorized' }), { status: 401 }),
    )

    const error = await client.listRequests([]).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ForgeError)
    expect((error as ForgeError).isAuthError).toBe(true)
    expect((error as ForgeError).message).toBe('HTTP 401: 401 Unauthorized')
  })
})
