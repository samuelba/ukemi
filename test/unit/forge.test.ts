import { describe, expect, test } from 'vitest'
import { detectForge, forgeKindForHost, unknownHosts } from '../../src/forge/detect'
import { GithubClient, githubCheckState, githubCi, githubState } from '../../src/forge/github'
import { GitlabClient, gitlabCi, gitlabPipelineCi, gitlabState } from '../../src/forge/gitlab'
import { isAllowedForgeUrl } from '../../src/forge/hostName'
import { clampRequestLimit } from '../../src/forge/requestLimit'
import { FORGE_REFRESH_PENDING_MS, forgeRefreshInterval } from '../../src/forge/refreshInterval'
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

  test('uses the next remote when origin is on an unknown host', () => {
    const remotes = [
      { name: 'fork', url: 'git@git.example.com:me/repo.git' },
      { name: 'origin', url: 'https://git.example.com/me/repo.git' },
      { name: 'upstream', url: 'https://github.com/team/repo.git' },
    ]

    expect(detectForge(remotes, lists)).toEqual({
      kind: 'github',
      host: 'github.com',
      projectPath: 'team/repo',
      remote: 'upstream',
    })
  })

  test('lists unknown hosts once and skips known hosts', () => {
    const remotes = [
      { name: 'origin', url: 'https://git.example.com/me/repo.git' },
      { name: 'fork', url: 'git@git.example.com:me/fork.git' },
      { name: 'mirror', url: 'https://code.example.org/team/repo.git' },
      { name: 'upstream', url: 'https://github.com/team/repo.git' },
      { name: 'local', url: '/tmp/remote.git' },
    ]

    expect(unknownHosts(remotes, lists)).toEqual(['git.example.com', 'code.example.org'])
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
    expect(githubCheckState('COMPLETED', 'SUCCESS')).toBe('success')
    expect(githubCheckState('COMPLETED', 'FAILURE')).toBe('failure')
    expect(githubCheckState('COMPLETED', 'SKIPPED')).toBe('skipped')
    expect(githubCheckState('IN_PROGRESS', null)).toBe('pending')
  })

  test('maps GitLab merge request states', () => {
    expect(gitlabState({ state: 'opened' }, null)).toBe('open')
    expect(gitlabState({ state: 'opened', draft: true }, null)).toBe('draft')
    expect(gitlabState({ state: 'opened' }, { approved: false, approvalCount: 1 })).toBe('reviewed')
    expect(gitlabState({ state: 'opened' }, { approved: true, approvalCount: 1 })).toBe('approved')
    expect(gitlabState({ state: 'merged' }, null)).toBe('merged')
    expect(gitlabCi('running')).toBe('pending')
    expect(gitlabCi('success')).toBe('success')
    expect(gitlabCi('manual')).toBe('manual')
    expect(gitlabCi('skipped')).toBe('skipped')
  })

  test('counts unrun manual jobs as optional once a job has succeeded', () => {
    const check = (state: 'success' | 'manual' | 'skipped' | 'failure' | 'pending') => ({
      name: state,
      state,
      url: 'https://git.example/job',
    })
    expect(gitlabPipelineCi('manual', [check('success'), check('manual')])).toBe('success')
    expect(gitlabPipelineCi('manual', [check('success'), check('skipped'), check('manual')])).toBe(
      'success',
    )
    expect(gitlabPipelineCi('manual', [check('manual')])).toBe('manual')
    expect(gitlabPipelineCi('manual', [check('success'), check('failure')])).toBe('manual')
    expect(gitlabPipelineCi('manual', [check('success'), check('pending')])).toBe('manual')
    expect(gitlabPipelineCi('manual', [])).toBe('manual')
    expect(gitlabPipelineCi('failed', [check('success'), check('manual')])).toBe('failure')
    expect(gitlabPipelineCi('success', [check('success'), check('manual')])).toBe('success')
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
    const node = (number: number, head: string, login: string) => ({
      number,
      title: `PR ${number}`,
      url: `https://github.com/o/r/pull/${number}`,
      state: 'OPEN',
      isDraft: false,
      headRefName: head,
      baseRefName: 'main',
      author: { login },
      reviewDecision: null,
      latestReviews: { totalCount: 0 },
      commits: {
        nodes: [
          {
            commit: {
              statusCheckRollup: {
                state: 'SUCCESS',
                contexts: {
                  nodes: [
                    {
                      __typename: 'CheckRun',
                      name: 'ci',
                      status: 'COMPLETED',
                      conclusion: 'SUCCESS',
                      detailsUrl: 'https://github.com/o/r/actions/runs/1',
                    },
                    {
                      __typename: 'StatusContext',
                      context: 'review',
                      state: 'PENDING',
                      targetUrl: 'https://github.com/o/r/status',
                    },
                    { __typename: 'UnknownContext' },
                    null,
                  ],
                },
              },
            },
          },
        ],
      },
    })
    const client = new GithubClient(
      'github.com',
      'o/r',
      'token',
      fakeFetch({
        graphql: {
          data: {
            viewer: { login: 'Sam' },
            repository: {
              pullRequests: { nodes: [node(1, 'mine', 'sam'), node(2, 'other', 'ada')] },
            },
          },
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
        isMine: true,
        pipelineUrl: 'https://github.com/o/r/pull/1/checks',
        checks: [
          { name: 'ci', state: 'success', url: 'https://github.com/o/r/actions/runs/1' },
          { name: 'review', state: 'pending', url: 'https://github.com/o/r/status' },
        ],
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
  test('lists merge requests with jobs for the current author', async () => {
    const calls: string[] = []
    const client = new GitlabClient(
      'git.anybotics.com',
      'team/sub/repo',
      't',
      fakeFetch(
        {
          '/pipelines/42/jobs': [
            {
              name: 'test',
              stage: 'test',
              status: 'failed',
              web_url: 'https://git.anybotics.com/team/sub/repo/-/jobs/1',
            },
          ],
          '/merge_requests/7/approvals': { approved: true, approved_by: [{}] },
          '/merge_requests/8/approvals': { approved: false, approved_by: [] },
          '/merge_requests/7': { head_pipeline: { id: 42, status: 'failed' } },
          '/merge_requests/8': { head_pipeline: null },
          '/api/v4/user': { id: 5 },
          '/merge_requests?': [
            {
              iid: 7,
              title: 'MR',
              web_url: 'https://git.anybotics.com/team/sub/repo/-/merge_requests/7',
              state: 'opened',
              draft: false,
              source_branch: 'feat',
              target_branch: 'main',
              author: { id: 5 },
              head_pipeline: {
                id: 42,
                status: 'failed',
                web_url: 'https://git.anybotics.com/team/sub/repo/-/pipelines/42',
              },
            },
            {
              iid: 8,
              title: 'Other',
              web_url: 'https://git.anybotics.com/team/sub/repo/-/merge_requests/8',
              state: 'opened',
              draft: false,
              source_branch: 'other',
              target_branch: 'main',
              author: { id: 9 },
              head_pipeline: { id: 43, status: 'running' },
            },
          ],
        },
        calls,
      ),
    )

    const requests = await client.listRequests(['feat', 'other'])

    expect(requests[0]).toMatchObject({
      number: 7,
      state: 'approved',
      ci: 'failure',
      isMine: true,
      pipelineUrl: 'https://git.anybotics.com/team/sub/repo/-/pipelines/42',
      checks: [
        {
          name: 'test',
          stage: 'test',
          state: 'failure',
          url: 'https://git.anybotics.com/team/sub/repo/-/jobs/1',
        },
      ],
    })
    expect(requests[1]).toMatchObject({ number: 8, isMine: false, checks: [] })
    expect(calls.some((call) => call.includes('/pipelines/43/jobs'))).toBe(false)
  })

  test('reports success when the remaining jobs are unrun manual jobs', async () => {
    const job = (id: number, name: string, stage: string, status: string) => ({
      id,
      name,
      stage,
      status,
      web_url: `https://git.anybotics.com/team/sub/repo/-/jobs/${id}`,
    })
    const client = new GitlabClient(
      'git.anybotics.com',
      'team/sub/repo',
      't',
      fakeFetch({
        '/pipelines/42/jobs': [
          job(1, 'test_scripts', 'test', 'success'),
          job(2, 'update_repositories', 'update', 'manual'),
        ],
        '/pipelines/42/bridges': [],
        '/merge_requests/42/approvals': { approved: false, approved_by: [] },
        '/merge_requests/42': { head_pipeline: { id: 42, status: 'manual' } },
        '/api/v4/user': { id: 5 },
        '/merge_requests?': [
          {
            iid: 42,
            title: 'MR',
            web_url: 'https://git.anybotics.com/team/sub/repo/-/merge_requests/42',
            state: 'opened',
            source_branch: 'feat',
            target_branch: 'main',
            author: { id: 5 },
            head_pipeline: { id: 42, status: 'manual' },
          },
        ],
      }),
    )

    const requests = await client.listRequests(['feat'])

    expect(requests[0]?.ci).toBe('success')
    expect(requests[0]?.checks.map((check) => check.state)).toEqual(['success', 'manual'])
  })

  test('appends downstream trigger jobs and keeps stage creation order', async () => {
    const calls: string[] = []
    const job = (id: number, name: string, stage: string, status: string) => ({
      id,
      name,
      stage,
      status,
      web_url: `https://git.anybotics.com/team/sub/repo/-/jobs/${id}`,
    })
    const client = new GitlabClient(
      'git.anybotics.com',
      'team/sub/repo',
      't',
      fakeFetch(
        {
          '/pipelines/42/jobs': [
            job(3, 'prep', 'merge-prep', 'success'),
            job(1, 'version-job', 'version', 'success'),
          ],
          '/pipelines/42/bridges': [
            {
              ...job(2, 'pipeline_all', 'triggers', 'success'),
              downstream_pipeline: { id: 99, project_id: 21 },
            },
          ],
          '/pipelines/99/jobs': [
            job(11, 'build-image', 'build', 'failed'),
            job(10, 'child-version', 'version', 'success'),
          ],
          '/pipelines/99/bridges': [job(12, 'install-desktop', 'hardware-in-the-loop', 'skipped')],
          '/merge_requests/7/approvals': { approved: false, approved_by: [] },
          '/merge_requests/7': { head_pipeline: { id: 42, status: 'success' } },
          '/api/v4/user': { id: 5 },
          '/merge_requests?': [
            {
              iid: 7,
              title: 'MR',
              web_url: 'https://git.anybotics.com/team/sub/repo/-/merge_requests/7',
              state: 'opened',
              source_branch: 'feat',
              target_branch: 'main',
              author: { id: 5 },
              head_pipeline: { id: 42, status: 'success' },
            },
          ],
        },
        calls,
      ),
    )

    const requests = await client.listRequests(['feat'])

    expect(requests[0]?.checks.map((check) => [check.stage, check.name])).toEqual([
      ['version', 'version-job'],
      ['triggers', 'pipeline_all'],
      ['merge-prep', 'prep'],
      ['version', 'child-version'],
      ['build', 'build-image'],
      ['hardware-in-the-loop', 'install-desktop'],
    ])
    expect(calls.some((call) => call.includes('/projects/21/pipelines/99/jobs'))).toBe(true)
  })

  test('loads a later page when the request limit is above 100', async () => {
    const pages: string[] = []
    const mergeRequest = (iid: number) => ({
      iid,
      title: `MR ${iid}`,
      web_url: `https://gitlab.com/a/b/-/merge_requests/${iid}`,
      state: 'opened',
      source_branch: iid === 101 ? 'wanted' : 'other',
      target_branch: 'main',
      author: { id: 1 },
    })
    const client = new GitlabClient('gitlab.com', 'a/b', 't', async (url) => {
      if (url.includes('/api/v4/user')) {
        return new Response(JSON.stringify({ id: 1 }), { status: 200 })
      }
      if (url.includes('/approvals')) {
        return new Response(JSON.stringify({ approved: false, approved_by: [] }), { status: 200 })
      }
      if (!url.includes('/merge_requests?')) {
        return new Response(JSON.stringify({ head_pipeline: null }), { status: 200 })
      }
      const page = new URL(url).searchParams.get('page') ?? ''
      pages.push(page)
      const start = page === '2' ? 100 : 0
      const count = page === '2' ? 20 : 100
      return new Response(
        JSON.stringify(Array.from({ length: count }, (_, index) => mergeRequest(start + index))),
        { status: 200 },
      )
    })

    const requests = await client.listRequests(['wanted'], 120)

    expect(pages).toEqual(['1', '2'])
    expect(requests.map((request) => request.number)).toEqual([101])
  })

  test('sends a bearer token for an OAuth session', async () => {
    const headers: string[] = []
    const client = new GitlabClient(
      'gitlab.com',
      'a/b',
      'oauth-token',
      async (_url, init) => {
        headers.push(new Headers(init.headers).get('authorization') ?? '')
        return new Response(JSON.stringify({ message: 'no' }), { status: 401 })
      },
      'oauth',
    )

    await client.listRequests([]).catch(() => undefined)

    expect(headers.length).toBeGreaterThan(0)
    expect(headers.every((value) => value === 'Bearer oauth-token')).toBe(true)
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

describe('forge helpers', () => {
  test('clamps the request list size', () => {
    expect(clampRequestLimit(50)).toBe(50)
    expect(clampRequestLimit(0)).toBe(1)
    expect(clampRequestLimit(900)).toBe(500)
    expect(clampRequestLimit(Number.NaN)).toBe(50)
  })

  test('polls faster while one of my requests is pending', () => {
    expect(forgeRefreshInterval([{ isMine: true, ci: 'pending', state: 'open' }])).toBe(
      FORGE_REFRESH_PENDING_MS,
    )
    expect(forgeRefreshInterval([{ isMine: false, ci: 'pending', state: 'open' }])).toBe(60_000)
    expect(forgeRefreshInterval([{ isMine: true, ci: 'pending', state: 'merged' }])).toBe(60_000)
  })

  test('scales the pending poll with the idle interval', () => {
    const pending = { isMine: true, ci: 'pending' as const, state: 'open' as const }
    const idle = { isMine: false, ci: 'pending' as const, state: 'open' as const }
    expect(forgeRefreshInterval([pending], 300_000)).toBe(75_000)
    expect(forgeRefreshInterval([idle], 300_000)).toBe(300_000)
    expect(forgeRefreshInterval([pending], 20_000)).toBe(10_000)
    expect(forgeRefreshInterval([pending], 10_000)).toBe(10_000)
  })

  test('allows https links on the forge host only', () => {
    expect(
      isAllowedForgeUrl('https://git.anybotics.com/group/repo/-/jobs/1', 'git.anybotics.com'),
    ).toBe(true)
    expect(isAllowedForgeUrl('https://github.com/o/r/pull/1', 'git.anybotics.com')).toBe(false)
    expect(isAllowedForgeUrl('http://git.anybotics.com/group/repo', 'git.anybotics.com')).toBe(
      false,
    )
    expect(isAllowedForgeUrl('not a url', 'git.anybotics.com')).toBe(false)
  })
})
