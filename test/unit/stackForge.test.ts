import { describe, expect, test } from 'vitest'
import { GithubClient } from '../../src/forge/github'
import { GitlabClient } from '../../src/forge/gitlab'
import type { HttpFetch } from '../../src/forge/types'

interface Call {
  method: string
  url: string
  body: unknown
}

function recorder(respond: (call: Call) => { status?: number; body?: unknown }): {
  fetch: HttpFetch
  calls: Call[]
} {
  const calls: Call[] = []
  const fetchImpl: HttpFetch = async (url, init) => {
    const call: Call = {
      method: init.method ?? 'GET',
      url,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    const { status = 200, body = {} } = respond(call)
    return new Response(JSON.stringify(body), { status })
  }
  return { fetch: fetchImpl, calls }
}

const STACKS = 'https://api.github.com/repos/o/r/stacks'

function stack(number: number, pulls: { number: number; merged_at?: string | null }[]) {
  return { number, pull_requests: pulls }
}

describe('updateRequestBase', () => {
  test('patches the GitHub pull request base', async () => {
    const { fetch, calls } = recorder(() => ({}))

    await new GithubClient('github.com', 'o/r', 't', fetch).updateRequestBase(7, 'feat')

    expect(calls).toEqual([
      { method: 'PATCH', url: 'https://api.github.com/repos/o/r/pulls/7', body: { base: 'feat' } },
    ])
  })

  test('changes the GitLab merge request target branch', async () => {
    const { fetch, calls } = recorder(() => ({}))

    await new GitlabClient('gitlab.com', 'g/p', 't', fetch, 'pat').updateRequestBase(7, 'feat')

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { target_branch: 'feat' } })
    expect(calls[0]?.url).toMatch(/\/merge_requests\/7$/)
  })
})

describe('GithubClient.syncNativeStack', () => {
  const client = (respond: (call: Call) => { status?: number; body?: unknown }) => {
    const { fetch, calls } = recorder(respond)
    return { github: new GithubClient('github.com', 'o/r', 't', fetch), calls }
  }

  test('creates a stack for pull requests that are not stacked yet', async () => {
    const { github, calls } = client((call) => ({ body: call.method === 'GET' ? [] : {} }))

    await expect(github.syncNativeStack([1, 2, 3])).resolves.toBe('created')

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${STACKS}?pull_request=1`,
      `POST ${STACKS}`,
    ])
    expect(calls[1]?.body).toEqual({ pull_requests: [1, 2, 3] })
  })

  test('adds only the new pull requests to an existing stack', async () => {
    const { github, calls } = client((call) => ({
      body: call.method === 'GET' ? [stack(4, [{ number: 1 }, { number: 2 }])] : {},
    }))

    await expect(github.syncNativeStack([1, 2, 3])).resolves.toBe('extended')

    expect(calls[1]).toMatchObject({ method: 'POST', url: `${STACKS}/4/add` })
    expect(calls[1]?.body).toEqual({ pull_requests: [3] })
  })

  test('ignores merged pull requests of the existing stack', async () => {
    const { github, calls } = client((call) => ({
      body:
        call.method === 'GET'
          ? [stack(4, [{ number: 9, merged_at: '2026-01-01T00:00:00Z' }, { number: 1 }])]
          : {},
    }))

    await expect(github.syncNativeStack([1, 2])).resolves.toBe('extended')
    expect(calls[1]?.body).toEqual({ pull_requests: [2] })
  })

  test('does nothing when the stack is up to date', async () => {
    const { github, calls } = client(() => ({ body: [stack(4, [{ number: 1 }, { number: 2 }])] }))

    await expect(github.syncNativeStack([1, 2])).resolves.toBe('unchanged')
    expect(calls).toHaveLength(1)
  })

  test('leaves a stack alone when its order differs', async () => {
    const { github, calls } = client(() => ({ body: [stack(4, [{ number: 2 }, { number: 1 }])] }))

    await expect(github.syncNativeStack([1, 2])).resolves.toBe('diverged')
    expect(calls).toHaveLength(1)
  })

  test('reports an unavailable API instead of failing', async () => {
    const { github } = client(() => ({ status: 404, body: { message: 'Not Found' } }))

    await expect(github.syncNativeStack([1, 2])).resolves.toBe('unavailable')
  })

  test('skips single pull requests', async () => {
    const { github, calls } = client(() => ({}))

    await expect(github.syncNativeStack([1])).resolves.toBe('unchanged')
    expect(calls).toHaveLength(0)
  })

  test('rethrows other errors', async () => {
    const { github } = client(() => ({ status: 500, body: { message: 'boom' } }))

    await expect(github.syncNativeStack([1, 2])).rejects.toThrow('HTTP 500')
  })
})

describe('GithubClient.mergeRequest', () => {
  const PULL = 'https://api.github.com/repos/o/r/pulls/5'
  const refused = {
    status: 403,
    body: {
      message:
        'Merging stacked PRs via this endpoint is not supported. Use the asynchronous merge endpoint instead.',
    },
  }
  const client = (respond: (call: Call) => { status?: number; body?: unknown }) => {
    const { fetch, calls } = recorder(respond)
    const github = new GithubClient('github.com', 'o/r', 't', fetch, async () => undefined)
    return { github, calls }
  }

  test('merges a plain pull request synchronously', async () => {
    const { github, calls } = client(() => ({}))

    await expect(github.mergeRequest(5, 'squash')).resolves.toBe('merged')
    expect(calls.map((c) => c.url)).toEqual([`${PULL}/merge`])
  })

  test('falls back to the asynchronous merge for a stacked pull request', async () => {
    let polls = 0
    const { github, calls } = client((call) => {
      if (call.url.endsWith('/merge')) {
        return refused
      }
      if (call.method === 'PUT') {
        return { status: 202, body: { status: 'pending', details: { uuid: 'abc' } } }
      }
      polls += 1
      return { body: { status: polls < 2 ? 'pending' : 'merged', details: { uuid: 'abc' } } }
    })

    await expect(github.mergeRequest(5, 'squash')).resolves.toBe('merged')

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `PUT ${PULL}/merge`,
      `PUT ${PULL}/merge-async`,
      `GET ${PULL}/merge-async/abc`,
      `GET ${PULL}/merge-async/abc`,
    ])
    expect(calls[1]?.body).toEqual({ merge_method: 'squash', merge_action: 'default' })
  })

  test('reports a merge queue', async () => {
    const { github } = client((call) =>
      call.url.endsWith('/merge') ? refused : { body: { status: 'enqueued' } },
    )

    await expect(github.mergeRequest(5, 'merge')).resolves.toBe('enqueued')
  })

  test('throws the reason when the stack merge fails', async () => {
    const { github } = client((call) =>
      call.url.endsWith('/merge')
        ? refused
        : { body: { status: 'failed', details: { message: 'Required checks are failing' } } },
    )

    await expect(github.mergeRequest(5, 'merge')).rejects.toThrow('Required checks are failing')
  })

  test('does not hide other merge errors', async () => {
    const { github, calls } = client(() => ({ status: 405, body: { message: 'Not mergeable' } }))

    await expect(github.mergeRequest(5, 'merge')).rejects.toThrow('Not mergeable')
    expect(calls).toHaveLength(1)
  })
})
