import { z } from 'zod'
import type { CiCheck, CiState, RequestBadge, RequestState } from '../../shared/protocol'
import { clampRequestLimit, DEFAULT_REQUEST_LIMIT, REQUEST_PAGE_SIZE } from './requestLimit'
import {
  requestJson,
  type CreateRequestInput,
  type ForgeClient,
  type HttpFetch,
  type MergeMethod,
} from './types'

const checkRunSchema = z.object({
  __typename: z.literal('CheckRun'),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  detailsUrl: z.string().nullable(),
})

const statusContextSchema = z.object({
  __typename: z.literal('StatusContext'),
  context: z.string(),
  state: z.string(),
  targetUrl: z.string().nullable(),
})

const contextNodeSchema = z.union([
  checkRunSchema,
  statusContextSchema,
  z.object({ __typename: z.string() }).passthrough(),
])

const pullSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: z.boolean(),
  headRefName: z.string(),
  baseRefName: z.string(),
  author: z.object({ login: z.string() }).nullable().optional(),
  reviewDecision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']).nullable(),
  latestReviews: z.object({ totalCount: z.number() }),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          statusCheckRollup: z
            .object({
              state: z.string(),
              contexts: z
                .object({ nodes: z.array(contextNodeSchema.nullable()) })
                .nullable()
                .optional(),
            })
            .nullable(),
        }),
      }),
    ),
  }),
})

const listSchema = z.object({
  data: z.object({
    viewer: z.object({ login: z.string() }).nullish(),
    repository: z
      .object({
        pullRequests: z.object({
          pageInfo: z
            .object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })
            .optional(),
          nodes: z.array(pullSchema),
        }),
      })
      .nullable(),
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
type GithubContext = z.infer<typeof contextNodeSchema>

export function githubState(
  pull: Pick<GithubPull, 'state' | 'isDraft' | 'reviewDecision' | 'latestReviews'>,
): RequestState {
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

export function githubCheckState(status: string, conclusion: string | null): CiState {
  if (status !== 'COMPLETED') {
    return 'pending'
  }
  switch (conclusion) {
    case 'SUCCESS':
      return 'success'
    case 'FAILURE':
    case 'CANCELLED':
    case 'TIMED_OUT':
    case 'STARTUP_FAILURE':
    case 'ACTION_REQUIRED':
      return 'failure'
    case 'SKIPPED':
      return 'skipped'
    default:
      return 'none'
  }
}

const LIST_QUERY = `query($owner: String!, $name: String!, $limit: Int!, $after: String) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequests(first: $limit, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url state isDraft headRefName baseRefName reviewDecision
        author { login }
        latestReviews(first: 1) { totalCount }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
                contexts(first: 50) {
                  nodes {
                    __typename
                    ... on CheckRun { name status conclusion detailsUrl }
                    ... on StatusContext { context state targetUrl }
                  }
                }
              }
            }
          }
        }
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
    return this.host === 'github.com'
      ? 'https://api.github.com/graphql'
      : `https://${this.host}/api/graphql`
  }

  private call(url: string, init: RequestInit = {}): Promise<unknown> {
    return requestJson(this.fetchImpl, url, { ...init, token: this.token, authScheme: 'Bearer' })
  }

  async listRequests(
    branches: readonly string[],
    limit = DEFAULT_REQUEST_LIMIT,
  ): Promise<RequestBadge[]> {
    const capped = clampRequestLimit(limit)
    const pulls: GithubPull[] = []
    let viewer: string | null = null
    let after: string | null = null
    while (pulls.length < capped) {
      const page = await this.pullPage(Math.min(REQUEST_PAGE_SIZE, capped - pulls.length), after)
      viewer = page.viewer ?? viewer
      pulls.push(...page.pulls)
      if (!page.endCursor || page.endCursor === after || page.pulls.length === 0) {
        break
      }
      after = page.endCursor
    }
    const wanted = new Set(branches)
    return pulls
      .filter((pull) => wanted.has(pull.headRefName))
      .map((pull) => this.toBadge(pull, viewer))
  }

  private async pullPage(
    limit: number,
    after: string | null,
  ): Promise<{ viewer: string | null; pulls: GithubPull[]; endCursor: string | null }> {
    const body = await this.call(this.graphqlUrl, {
      method: 'POST',
      body: JSON.stringify({
        query: LIST_QUERY,
        variables: { owner: this.owner, name: this.name, limit, after },
      }),
    })
    const data = listSchema.parse(body).data
    const connection = data.repository?.pullRequests
    const pageInfo = connection?.pageInfo
    return {
      viewer: data.viewer?.login ?? null,
      pulls: connection?.nodes ?? [],
      endCursor: pageInfo?.hasNextPage ? (pageInfo.endCursor ?? null) : null,
    }
  }

  private toBadge(pull: GithubPull, viewer: string | null): RequestBadge {
    const rollup = pull.commits.nodes[0]?.commit.statusCheckRollup ?? null
    const checks = mapContexts(rollup?.contexts?.nodes ?? [])
    const pipelineUrl = rollup ? `${pull.url}/checks` : undefined
    return {
      number: pull.number,
      title: pull.title,
      url: pull.url,
      state: githubState(pull),
      ci: githubCi(rollup?.state),
      isMine: sameLogin(pull.author?.login, viewer),
      ...(pipelineUrl ? { pipelineUrl } : {}),
      checks,
      headBranch: pull.headRefName,
      baseBranch: pull.baseRefName,
    }
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
      isMine: true,
      checks: [],
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

function sameLogin(author: string | null | undefined, viewer: string | null): boolean {
  return !!author && !!viewer && author.toLowerCase() === viewer.toLowerCase()
}

function mapContexts(nodes: readonly (GithubContext | null)[]): CiCheck[] {
  const checks: CiCheck[] = []
  for (const node of nodes) {
    const checkRun = checkRunSchema.safeParse(node)
    if (checkRun.success) {
      checks.push({
        name: checkRun.data.name,
        state: githubCheckState(checkRun.data.status, checkRun.data.conclusion),
        url: checkRun.data.detailsUrl ?? '',
      })
      continue
    }
    const status = statusContextSchema.safeParse(node)
    if (status.success) {
      checks.push({
        name: status.data.context,
        state: githubCi(status.data.state),
        url: status.data.targetUrl ?? '',
      })
    }
  }
  return checks
}
