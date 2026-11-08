import { z } from 'zod'
import { definedSpan, pipelineFields, pipelineSpan } from '../../shared/ciTiming'
import type {
  CiCheck,
  CiState,
  CiSummary,
  CommitCi,
  RequestBadge,
  RequestState,
} from '../../shared/protocol'
import {
  clampRequestLimit,
  DEFAULT_REQUEST_LIMIT,
  GITHUB_BRANCHES_PER_QUERY,
  REQUESTS_PER_BRANCH,
} from './requestLimit'
import {
  ForgeError,
  requestJson,
  type CreateRequestInput,
  type ForgeClient,
  type HttpFetch,
  type MergeMethod,
  type MergeOutcome,
  type NativeStackResult,
} from './types'

const checkRunSchema = z.object({
  __typename: z.literal('CheckRun'),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  detailsUrl: z.string().nullable(),
  startedAt: z.string().nullish(),
  completedAt: z.string().nullish(),
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

const rollupSchema = z
  .object({
    state: z.string(),
    contexts: z
      .object({ nodes: z.array(contextNodeSchema.nullable()) })
      .nullable()
      .optional(),
  })
  .nullable()

const pullSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: z.boolean(),
  headRefName: z.string(),
  baseRefName: z.string(),
  isCrossRepository: z.boolean().optional(),
  // Null once the fork is deleted.
  headRepositoryOwner: z.object({ login: z.string() }).nullish(),
  author: z.object({ login: z.string() }).nullable().optional(),
  reviewDecision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']).nullable(),
  latestReviews: z.object({ totalCount: z.number() }),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({ statusCheckRollup: rollupSchema }),
      }),
    ),
  }),
})

const commitCiSchema = z.object({
  data: z.object({
    repository: z
      .object({
        // Null when GitHub has no such commit; a non-commit object has no fields.
        object: z
          .object({
            url: z.string().optional(),
            statusCheckRollup: rollupSchema.optional(),
          })
          .nullable(),
      })
      .nullable(),
  }),
})

const listSchema = z.object({
  data: z.object({
    viewer: z.object({ login: z.string() }).nullish(),
    // One entry per head branch alias; a lookup GitHub could not answer is null.
    repository: z.record(z.object({ nodes: z.array(pullSchema) }).nullable()).nullable(),
  }),
})

// GraphQL answers HTTP 200 and lists its errors next to the data it could still read.
const graphqlErrorsSchema = z.object({
  errors: z.array(z.object({ message: z.string(), type: z.string().optional() })),
})

const GRAPHQL_ERROR_STATUS: Readonly<Record<string, number>> = {
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
}

function graphqlError(body: unknown): ForgeError | null {
  const parsed = graphqlErrorsSchema.safeParse(body)
  const errors = parsed.success ? parsed.data.errors : []
  if (errors.length === 0) {
    return null
  }
  const status = GRAPHQL_ERROR_STATUS[errors[0]?.type ?? ''] ?? 422
  const message = [...new Set(errors.map((error) => error.message))].join('; ')
  return new ForgeError(`GitHub: ${message}`, status, body)
}

const restPullSchema = z.object({
  number: z.number(),
  title: z.string(),
  html_url: z.string(),
  draft: z.boolean().optional(),
  head: z.object({ ref: z.string() }),
  base: z.object({ ref: z.string() }),
})

const stackListSchema = z.array(
  z.object({
    number: z.number(),
    pull_requests: z.array(
      z.object({
        number: z.number(),
        state: z.string().optional(),
        merged_at: z.string().nullable().optional(),
      }),
    ),
  }),
)

type GithubPull = z.infer<typeof pullSchema>

const asyncMergeSchema = z.object({
  status: z.string(),
  details: z.object({ uuid: z.string().optional(), message: z.string().optional() }).nullish(),
})

const ASYNC_MERGE_POLL_MS = 2_000
const ASYNC_MERGE_POLLS = 60

function requiresAsyncMerge(error: ForgeError): boolean {
  return error.status === 403 && /asynchronous merge/i.test(error.message)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
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

const ROLLUP_FIELDS = `fragment RollupFields on Commit {
  statusCheckRollup {
    state
    contexts(first: 50) {
      nodes {
        __typename
        ... on CheckRun { name status conclusion detailsUrl startedAt completedAt }
        ... on StatusContext { context state targetUrl }
      }
    }
  }
}`

const PULL_FIELDS = `fragment PullFields on PullRequest {
  number title url state isDraft headRefName baseRefName reviewDecision isCrossRepository
  headRepositoryOwner { login }
  author { login }
  latestReviews(first: 1) { totalCount }
  commits(last: 1) {
    nodes {
      commit { ...RollupFields }
    }
  }
}
${ROLLUP_FIELDS}`

export const COMMIT_CI_QUERY = `query($owner: String!, $name: String!, $oid: GitObjectID!) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) {
      ... on Commit { url ...RollupFields }
    }
  }
}
${ROLLUP_FIELDS}`

type GithubRollup = z.infer<typeof rollupSchema>

function rollupCi(rollup: GithubRollup, pipelineUrl: string | undefined): CiSummary {
  const checks = mapContexts(rollup?.contexts?.nodes ?? [])
  return {
    ci: githubCi(rollup?.state),
    ...(rollup && pipelineUrl ? { pipelineUrl } : {}),
    ...pipelineFields(pipelineSpan(checks)),
    checks,
  }
}

// One aliased lookup per head branch, so a busy repository cannot push a bookmark's request out of
// a list of the newest ones.
export function branchQuery(count: number): string {
  const variables = Array.from({ length: count }, (_, index) => `, $b${index}: String!`).join('')
  const lookups = Array.from(
    { length: count },
    (_, index) =>
      `    b${index}: pullRequests(headRefName: $b${index}, first: ${REQUESTS_PER_BRANCH}, ` +
      `orderBy: {field: UPDATED_AT, direction: DESC}) ` +
      `{ nodes { ...PullFields } }`,
  ).join('\n')
  return `query($owner: String!, $name: String!${variables}) {
  viewer { login }
  repository(owner: $owner, name: $name) {
${lookups}
  }
}
${PULL_FIELDS}`
}

export class GithubClient implements ForgeClient {
  readonly kind = 'github' as const
  private readonly owner: string
  private readonly name: string

  constructor(
    readonly host: string,
    projectPath: string,
    private readonly token: string,
    private readonly fetchImpl: HttpFetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = delay,
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
    const wanted = [...new Set(branches)].slice(0, clampRequestLimit(limit))
    const pulls = new Map<number, GithubPull>()
    let viewer: string | null = null
    for (let start = 0; start < wanted.length; start += GITHUB_BRANCHES_PER_QUERY) {
      const page = await this.branchPage(wanted.slice(start, start + GITHUB_BRANCHES_PER_QUERY))
      viewer = page.viewer ?? viewer
      for (const pull of page.pulls) {
        pulls.set(pull.number, pull)
      }
    }
    return [...pulls.values()]
      .filter((pull) => isOwnHead(pull, viewer))
      .map((pull) => this.toBadge(pull, viewer))
  }

  private async branchPage(
    branches: readonly string[],
  ): Promise<{ viewer: string | null; pulls: GithubPull[] }> {
    const variables = Object.fromEntries(branches.map((branch, index) => [`b${index}`, branch]))
    const body = await this.call(this.graphqlUrl, {
      method: 'POST',
      body: JSON.stringify({
        query: branchQuery(branches.length),
        variables: { owner: this.owner, name: this.name, ...variables },
      }),
    })
    const parsed = listSchema.safeParse(body)
    if (!parsed.success || !parsed.data.data.repository) {
      throw (
        graphqlError(body) ??
        (parsed.success
          ? new ForgeError(
              `GitHub has no repository ${this.owner}/${this.name} for this login`,
              404,
            )
          : parsed.error)
      )
    }
    const data = parsed.data.data
    const lookups = Object.values(data.repository ?? {})
    return {
      viewer: data.viewer?.login ?? null,
      // Only the heads this query asked for count.
      pulls: lookups
        .flatMap((lookup) => lookup?.nodes ?? [])
        .filter((pull) => branches.includes(pull.headRefName)),
    }
  }

  private toBadge(pull: GithubPull, viewer: string | null): RequestBadge {
    const rollup = pull.commits.nodes[0]?.commit.statusCheckRollup ?? null
    return {
      number: pull.number,
      title: pull.title,
      url: pull.url,
      state: githubState(pull),
      isMine: sameLogin(pull.author?.login, viewer),
      ...rollupCi(rollup, `${pull.url}/checks`),
      headBranch: pull.headRefName,
      baseBranch: pull.baseRefName,
    }
  }

  async commitCi(commitId: string): Promise<CommitCi | null> {
    const body = await this.call(this.graphqlUrl, {
      method: 'POST',
      body: JSON.stringify({
        query: COMMIT_CI_QUERY,
        variables: { owner: this.owner, name: this.name, oid: commitId },
      }),
    })
    const parsed = commitCiSchema.safeParse(body)
    const error = graphqlError(body)
    if (error?.status === 404) {
      return null
    }
    if (!parsed.success || error) {
      throw error ?? parsed.error
    }
    const commit = parsed.data.data.repository?.object
    if (!commit || commit.statusCheckRollup === undefined) {
      return null
    }
    return { commitId, ...rollupCi(commit.statusCheckRollup, commit.url) }
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

  async mergeRequest(number: number, method: MergeMethod): Promise<MergeOutcome> {
    const base = `${this.apiBase}/repos/${this.owner}/${this.name}/pulls/${number}`
    try {
      await this.call(`${base}/merge`, {
        method: 'PUT',
        body: JSON.stringify({ merge_method: method }),
      })
      return 'merged'
    } catch (error) {
      if (!(error instanceof ForgeError) || !requiresAsyncMerge(error)) {
        throw error
      }
    }
    return this.mergeAsync(base, method)
  }

  // Stacked pull requests only merge through this endpoint, which merges every request below too.
  private async mergeAsync(base: string, method: MergeMethod): Promise<MergeOutcome> {
    let result = asyncMergeSchema.parse(
      await this.call(`${base}/merge-async`, {
        method: 'PUT',
        body: JSON.stringify({ merge_method: method, merge_action: 'default' }),
      }),
    )
    for (let attempt = 0; result.status === 'pending'; attempt++) {
      const uuid = result.details?.uuid
      if (!uuid || attempt >= ASYNC_MERGE_POLLS) {
        throw new ForgeError(
          'The stack merge is still running. Check the pull request on GitHub.',
          0,
        )
      }
      await this.sleep(ASYNC_MERGE_POLL_MS)
      result = asyncMergeSchema.parse(await this.call(`${base}/merge-async/${uuid}`))
    }
    if (result.status === 'failed') {
      throw new ForgeError(result.details?.message ?? 'The stack could not be merged.', 422)
    }
    return result.status === 'enqueued' ? 'enqueued' : 'merged'
  }

  async updateRequestBase(number: number, base: string): Promise<void> {
    await this.call(`${this.apiBase}/repos/${this.owner}/${this.name}/pulls/${number}`, {
      method: 'PATCH',
      body: JSON.stringify({ base }),
    })
  }

  // Native stacks are a GitHub preview feature, so a missing endpoint is reported, not thrown.
  async syncNativeStack(numbers: readonly number[]): Promise<NativeStackResult> {
    const first = numbers[0]
    if (first === undefined || numbers.length < 2) {
      return 'unchanged'
    }
    const stacksUrl = `${this.apiBase}/repos/${this.owner}/${this.name}/stacks`
    let stacks: z.infer<typeof stackListSchema>
    try {
      stacks = stackListSchema.parse(await this.call(`${stacksUrl}?pull_request=${first}`))
    } catch (error) {
      if (error instanceof ForgeError && error.status === 404) {
        return 'unavailable'
      }
      throw error
    }
    const existing = stacks[0]
    if (!existing) {
      await this.call(stacksUrl, {
        method: 'POST',
        body: JSON.stringify({ pull_requests: numbers }),
      })
      return 'created'
    }
    const current = existing.pull_requests
      .filter((pull) => !pull.merged_at && pull.state !== 'closed')
      .map((pull) => pull.number)
    if (!current.every((number, index) => numbers[index] === number)) {
      return 'diverged'
    }
    const added = numbers.slice(current.length)
    if (added.length === 0) {
      return 'unchanged'
    }
    await this.call(`${stacksUrl}/${existing.number}/add`, {
      method: 'POST',
      body: JSON.stringify({ pull_requests: added }),
    })
    return 'extended'
  }
}

// A fork's branch only shares a name with a bookmark here, unless the signed-in user owns the fork.
function isOwnHead(
  pull: Pick<GithubPull, 'isCrossRepository' | 'headRepositoryOwner'>,
  viewer: string | null,
): boolean {
  return !pull.isCrossRepository || sameLogin(pull.headRepositoryOwner?.login, viewer)
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
        ...definedSpan(checkRun.data.startedAt, checkRun.data.completedAt),
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
