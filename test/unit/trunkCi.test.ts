import { describe, expect, test } from 'vitest'
import { COMMIT_CI_QUERY, GithubClient } from '../../src/forge/github'
import { GitlabClient } from '../../src/forge/gitlab'
import { ForgeError, type HttpFetch } from '../../src/forge/types'

const SHA = '0123456789abcdef0123456789abcdef01234567'

interface Recorded {
  url: string
  body: unknown
}

function recordingFetch(
  answer: (url: string) => { status: number; body: unknown },
  calls: Recorded[] = [],
): HttpFetch {
  return async (url, init) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null })
    const { status, body } = answer(url)
    return new Response(JSON.stringify(body), { status })
  }
}

function graphql(object: unknown): { status: number; body: unknown } {
  return { status: 200, body: { data: { repository: { object } } } }
}

describe('GithubClient.commitCi', () => {
  test('reads the check rollup of the commit', async () => {
    const calls: Recorded[] = []
    const client = new GithubClient(
      'github.com',
      'o/r',
      't',
      recordingFetch(
        () =>
          graphql({
            url: `https://github.com/o/r/commit/${SHA}`,
            statusCheckRollup: {
              state: 'PENDING',
              contexts: {
                nodes: [
                  {
                    __typename: 'CheckRun',
                    name: 'build',
                    status: 'COMPLETED',
                    conclusion: 'SUCCESS',
                    detailsUrl: 'https://github.com/o/r/actions/runs/1',
                    startedAt: '2026-11-08T10:00:00Z',
                    completedAt: '2026-11-08T10:02:00Z',
                  },
                  {
                    __typename: 'CheckRun',
                    name: 'test',
                    status: 'IN_PROGRESS',
                    conclusion: null,
                    detailsUrl: 'https://github.com/o/r/actions/runs/2',
                    startedAt: '2026-11-08T10:00:30Z',
                    completedAt: null,
                  },
                ],
              },
            },
          }),
        calls,
      ),
    )

    expect(await client.commitCi(SHA)).toEqual({
      commitId: SHA,
      ci: 'pending',
      pipelineUrl: `https://github.com/o/r/commit/${SHA}`,
      pipelineStartedAt: '2026-11-08T10:00:00Z',
      checks: [
        {
          name: 'build',
          state: 'success',
          url: 'https://github.com/o/r/actions/runs/1',
          startedAt: '2026-11-08T10:00:00Z',
          finishedAt: '2026-11-08T10:02:00Z',
        },
        {
          name: 'test',
          state: 'pending',
          url: 'https://github.com/o/r/actions/runs/2',
          startedAt: '2026-11-08T10:00:30Z',
        },
      ],
    })
    expect(calls).toEqual([
      {
        url: 'https://api.github.com/graphql',
        body: { query: COMMIT_CI_QUERY, variables: { owner: 'o', name: 'r', oid: SHA } },
      },
    ])
  })

  test('shows no CI for a commit without checks', async () => {
    const client = new GithubClient(
      'github.com',
      'o/r',
      't',
      recordingFetch(() =>
        graphql({ url: 'https://github.com/o/r/commit/x', statusCheckRollup: null }),
      ),
    )

    expect(await client.commitCi(SHA)).toEqual({ commitId: SHA, ci: 'none', checks: [] })
  })

  test('gives null for a commit GitHub does not know', async () => {
    const unknown = new GithubClient(
      'github.com',
      'o/r',
      't',
      recordingFetch(() => graphql(null)),
    )
    const notFound = new GithubClient(
      'github.com',
      'o/r',
      't',
      recordingFetch(() => ({
        status: 200,
        body: { data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: 'gone' }] },
      })),
    )

    expect(await unknown.commitCi(SHA)).toBeNull()
    expect(await notFound.commitCi(SHA)).toBeNull()
  })

  test('throws a used-up rate limit', async () => {
    const client = new GithubClient(
      'github.com',
      'o/r',
      't',
      recordingFetch(() => ({
        status: 200,
        body: { data: null, errors: [{ type: 'RATE_LIMITED', message: 'slow down' }] },
      })),
    )

    const error = await client.commitCi(SHA).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ForgeError)
    expect((error as ForgeError).isRateLimited).toBe(true)
  })
})

describe('GitlabClient.commitCi', () => {
  const host = 'git.example.com'
  const project = `https://${host}/api/v4/projects/team%2Frepo`

  test('reads the last pipeline of the commit and its jobs', async () => {
    const calls: Recorded[] = []
    const client = new GitlabClient(
      host,
      'team/repo',
      't',
      recordingFetch((url) => {
        if (url === `${project}/repository/commits/${SHA}`) {
          return {
            status: 200,
            body: {
              id: SHA,
              last_pipeline: {
                id: 77,
                status: 'failed',
                web_url: `https://${host}/team/repo/-/pipelines/77`,
                started_at: '2026-11-08T09:00:00Z',
                finished_at: '2026-11-08T09:10:00Z',
              },
            },
          }
        }
        if (url.startsWith(`${project}/pipelines/77/jobs`)) {
          return {
            status: 200,
            body: [
              {
                id: 1,
                name: 'lint',
                stage: 'check',
                status: 'failed',
                web_url: `https://${host}/team/repo/-/jobs/1`,
                started_at: '2026-11-08T09:00:00Z',
                finished_at: '2026-11-08T09:01:00Z',
              },
            ],
          }
        }
        return { status: 200, body: [] }
      }, calls),
    )

    expect(await client.commitCi(SHA)).toEqual({
      commitId: SHA,
      ci: 'failure',
      pipelineUrl: `https://${host}/team/repo/-/pipelines/77`,
      pipelineStartedAt: '2026-11-08T09:00:00Z',
      pipelineFinishedAt: '2026-11-08T09:10:00Z',
      checks: [
        {
          name: 'lint',
          stage: 'check',
          state: 'failure',
          url: `https://${host}/team/repo/-/jobs/1`,
          startedAt: '2026-11-08T09:00:00Z',
          finishedAt: '2026-11-08T09:01:00Z',
        },
      ],
    })
    expect(calls[0]?.url).toBe(`${project}/repository/commits/${SHA}`)
  })

  test('shows no CI for a commit without a pipeline', async () => {
    const client = new GitlabClient(
      host,
      'team/repo',
      't',
      recordingFetch(() => ({ status: 200, body: { id: SHA, last_pipeline: null } })),
    )

    expect(await client.commitCi(SHA)).toEqual({ commitId: SHA, ci: 'none', checks: [] })
  })

  test('gives null for a commit GitLab does not know', async () => {
    const client = new GitlabClient(
      host,
      'team/repo',
      't',
      recordingFetch(() => ({ status: 404, body: { message: '404 Commit Not Found' } })),
    )

    expect(await client.commitCi(SHA)).toBeNull()
  })
})
