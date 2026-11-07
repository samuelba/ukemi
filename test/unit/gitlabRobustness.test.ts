import { describe, expect, test } from 'vitest'
import { GitlabClient } from '../../src/forge/gitlab'
import { ForgeError, type HttpFetch } from '../../src/forge/types'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function openRequest(iid: number, branch: string): Record<string, unknown> {
  return {
    iid,
    title: `MR ${iid}`,
    web_url: `https://gitlab.com/a/b/-/merge_requests/${iid}`,
    state: 'opened',
    source_branch: branch,
    target_branch: 'main',
    author: { id: 9 },
  }
}

// Lists one open request per branch, numbered from 1, and answers its detail calls.
function gitlabFake(
  detail: (iid: number, url: string) => Response,
  calls: string[] = [],
): HttpFetch {
  return async (url, init) => {
    calls.push(`${init.method ?? 'GET'} ${url}`)
    if (url.endsWith('/api/v4/user')) {
      return json({ id: 5 })
    }
    const branch = new URL(url).searchParams.get('source_branch')
    if (branch !== null) {
      return json([openRequest(Number(branch.slice(1)), branch)])
    }
    const iid = Number(/merge_requests\/(\d+)/.exec(url)?.[1])
    return detail(iid, url)
  }
}

describe('GitLab request details', () => {
  test('keeps the other requests when one detail call fails', async () => {
    const client = new GitlabClient(
      'gitlab.com',
      'a/b',
      't',
      gitlabFake((iid, url) => {
        if (iid === 1) {
          return json({ message: 'boom' }, 500)
        }
        return url.endsWith('/approvals')
          ? json({ approved: true, approved_by: [{}] })
          : json({ head_pipeline: null })
      }),
    )

    const requests = await client.listRequests(['b1', 'b2'])

    expect(requests.map((request) => [request.number, request.state])).toEqual([
      [1, 'open'],
      [2, 'approved'],
    ])
  })

  test('still fails the list on a used-up rate limit', async () => {
    const client = new GitlabClient(
      'gitlab.com',
      'a/b',
      't',
      gitlabFake(() => json({ message: 'Too Many Requests' }, 429)),
    )

    const error = await client.listRequests(['b1']).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ForgeError)
    expect((error as ForgeError).isRateLimited).toBe(true)
  })

  test('loads approvals for every open request', async () => {
    const calls: string[] = []
    const branches = Array.from({ length: 12 }, (_, index) => `b${index + 1}`)
    const client = new GitlabClient(
      'gitlab.com',
      'a/b',
      't',
      gitlabFake(
        (_iid, url) =>
          url.endsWith('/approvals')
            ? json({ approved: true, approved_by: [{}] })
            : json({ head_pipeline: null }),
        calls,
      ),
    )

    const requests = await client.listRequests(branches)

    expect(requests).toHaveLength(12)
    expect(requests.every((request) => request.state === 'approved')).toBe(true)
    expect(calls.filter((call) => call.endsWith('/approvals'))).toHaveLength(12)
  })

  test('fails the list when the user cannot be read', async () => {
    const client = new GitlabClient('gitlab.com', 'a/b', 't', async (url) =>
      url.endsWith('/api/v4/user') ? json({ message: 'boom' }, 500) : json([]),
    )

    const error = await client.listRequests(['b1']).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ForgeError)
    expect((error as ForgeError).status).toBe(500)
  })
})

const INPUT = { head: 'feat', base: 'main', title: 'T', body: 'B', isDraft: false }

function createFake(project: Response | null, posted: Record<string, unknown>[]): HttpFetch {
  return async (url, init) => {
    if (init.method === 'POST') {
      posted.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return json(openRequest(9, 'feat'))
    }
    return url.endsWith('/projects/a%2Fb') && project ? project : json({}, 404)
  }
}

describe('GitLab source branch removal', () => {
  test.each([
    [json({ remove_source_branch_after_merge: false }), false],
    [json({ remove_source_branch_after_merge: true }), true],
  ])('creates a request with the project setting', async (project, expected) => {
    const posted: Record<string, unknown>[] = []
    const client = new GitlabClient('gitlab.com', 'a/b', 't', createFake(project, posted))

    await client.createRequest(INPUT)

    expect(posted[0]?.remove_source_branch).toBe(expected)
  })

  test('leaves the choice to GitLab when the project cannot be read', async () => {
    const posted: Record<string, unknown>[] = []
    const client = new GitlabClient('gitlab.com', 'a/b', 't', createFake(null, posted))

    await client.createRequest(INPUT)

    expect(posted[0]).not.toHaveProperty('remove_source_branch')
  })

  test('merges with the request own setting', async () => {
    const bodies: unknown[] = []
    const client = new GitlabClient('gitlab.com', 'a/b', 't', async (_url, init) => {
      bodies.push(JSON.parse(String(init.body)))
      return json({})
    })

    await client.mergeRequest(9, 'squash')

    expect(bodies).toEqual([{ squash: true }])
  })
})
