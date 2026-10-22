import { z } from 'zod'
import type { CiState, RequestBadge, RequestState } from '../../shared/protocol'
import { requestJson, type CreateRequestInput, type ForgeClient, type HttpFetch, type MergeMethod } from './types'

const LIST_LIMIT = 50

const pullSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: z.boolean(),
  headRefName: z.string(),
  baseRefName: z.string(),
  reviewDecision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']).nullable(),
  latestReviews: z.object({ totalCount: z.number() }),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({ statusCheckRollup: z.object({ state: z.string() }).nullable() }),
      }),
    ),
  }),
})

const listSchema = z.object({
  data: z.object({
    repository: z.object({ pullRequests: z.object({ nodes: z.array(pullSchema) }) }).nullable(),
  }),
})

const restPullSchema = z.object({
  number: z.number(),
  title: z.string(),
  html_url: z.string(),
  draft: z.boolean().optional(),
  head: z.object({ ref: z.string() }),
  base: z.object({ ref: z.string() }),
})

type GithubPull = z.infer<typeof pullSchema>

export function githubState(pull: Pick<GithubPull, 'state' | 'isDraft' | 'reviewDecision' | 'latestReviews'>): RequestState {
  if (pull.state === 'MERGED') {
    return 'merged'
  }
  if (pull.state === 'CLOSED') {
    return 'closed'
  }
  if (pull.isDraft) {
    return 'draft'
  }
  if (pull.reviewDecision === 'APPROVED') {
    return 'approved'
  }
  return pull.latestReviews.totalCount > 0 ? 'reviewed' : 'open'
}

export function githubCi(state: string | undefined): CiState {
  switch (state) {
    case 'SUCCESS':
      return 'success'
    case 'FAILURE':
    case 'ERROR':
      return 'failure'
    case 'PENDING':
    case 'EXPECTED':
      return 'pending'
    default:
      return 'none'
  }
}

const LIST_QUERY = `query($owner: String!, $name: String!, $limit: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: $limit, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number title url state isDraft headRefName baseRefName reviewDecision
        latestReviews(first: 1) { totalCount }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`

export class GithubClient implements ForgeClient {
  readonly kind = 'github' as const
  private readonly owner: string
  private readonly name: string

  constructor(
    readonly host: string,
    projectPath: string,
    private readonly token: string,
    private readonly fetchImpl: HttpFetch = fetch,
  ) {
    const [owner = '', name = ''] = projectPath.split('/')
    this.owner = owner
    this.name = name
  }

  private get apiBase(): string {
    return this.host === 'github.com' ? 'https://api.github.com' : `https://${this.host}/api/v3`
  }

  private get graphqlUrl(): string {
    return this.host === 'github.com' ? 'https://api.github.com/graphql' : `https://${this.host}/api/graphql`
  }

  private call(url: string, init: RequestInit = {}): Promise<unknown> {
    return requestJson(this.fetchImpl, url, { ...init, token: this.token, authScheme: 'Bearer' })
  }

  async listRequests(branches: readonly string[]): Promise<RequestBadge[]> {
    const body = await this.call(this.graphqlUrl, {
      method: 'POST',
      body: JSON.stringify({
        query: LIST_QUERY,
        variables: { owner: this.owner, name: this.name, limit: LIST_LIMIT },
      }),
    })
    const pulls = listSchema.parse(body).data.repository?.pullRequests.nodes ?? []
    const wanted = new Set(branches)
    return pulls
      .filter((pull) => wanted.has(pull.headRefName))
      .map((pull) => ({
        number: pull.number,
        title: pull.title,
        url: pull.url,
        state: githubState(pull),
        ci: githubCi(pull.commits.nodes[0]?.commit.statusCheckRollup?.state),
        headBranch: pull.headRefName,
        baseBranch: pull.baseRefName,
      }))
  }

  async createRequest(input: CreateRequestInput): Promise<RequestBadge> {
    const body = await this.call(`${this.apiBase}/repos/${this.owner}/${this.name}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
        draft: input.isDraft,
      }),
    })
    const pull = restPullSchema.parse(body)
    return {
      number: pull.number,
      title: pull.title,
      url: pull.html_url,
      state: pull.draft ? 'draft' : 'open',
      ci: 'none',
      headBranch: pull.head.ref,
      baseBranch: pull.base.ref,
    }
  }

  async mergeRequest(number: number, method: MergeMethod): Promise<void> {
    await this.call(`${this.apiBase}/repos/${this.owner}/${this.name}/pulls/${number}/merge`, {
      method: 'PUT',
      body: JSON.stringify({ merge_method: method }),
    })
  }
}
