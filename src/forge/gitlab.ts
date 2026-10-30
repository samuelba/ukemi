import { z } from 'zod'
import type { CiCheck, CiState, RequestBadge, RequestState } from '../../shared/protocol'
import { isSafeHttpsHost } from './hostName'
import { clampRequestLimit, DEFAULT_REQUEST_LIMIT, REQUEST_PAGE_SIZE } from './requestLimit'
import {
  ForgeError,
  requestJson,
  type CreateRequestInput,
  type ForgeClient,
  type HttpFetch,
  type MergeMethod,
  type MergeOutcome,
} from './types'

const DETAIL_LIMIT = 10
const JOB_LIMIT = 100
const MAX_JOB_PAGES = 3
const MISSING_BRANCH_RETRIES = 10
const MISSING_BRANCH_MAX_DELAY_MS = 3200
const MISSING_BRANCH_DELAYS_MS = [400, 800, 1600, MISSING_BRANCH_MAX_DELAY_MS]

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function missingBranchDelay(retry: number): number {
  const last = MISSING_BRANCH_DELAYS_MS.length - 1
  return MISSING_BRANCH_DELAYS_MS[Math.min(retry, last)] ?? MISSING_BRANCH_MAX_DELAY_MS
}

function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  return (value as Record<string, unknown>)[key]
}

function isMissingSourceBranch(error: unknown): boolean {
  if (!(error instanceof ForgeError) || error.status !== 400) {
    return false
  }
  const source = field(field(error.body, 'message'), 'source_branch')
  return Array.isArray(source) && source.includes('does not exist')
}

function byCreated<T extends { id?: number }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => (left.id ?? 0) - (right.id ?? 0))
}

function toCheck(job: { name: string; stage?: string; status: string; web_url: string }): CiCheck {
  return {
    name: job.name,
    ...(job.stage ? { stage: job.stage } : {}),
    state: gitlabCi(job.status),
    url: job.web_url,
  }
}

const pipelineSchema = z.object({
  id: z.number().optional(),
  status: z.string(),
  web_url: z.string().optional(),
})

const mergeRequestSchema = z.object({
  iid: z.number(),
  title: z.string(),
  web_url: z.string(),
  state: z.string(),
  draft: z.boolean().optional(),
  work_in_progress: z.boolean().optional(),
  source_branch: z.string(),
  target_branch: z.string(),
  author: z.object({ id: z.number() }).optional(),
  head_pipeline: pipelineSchema.nullable().optional(),
})

const detailSchema = z.object({
  head_pipeline: pipelineSchema.nullable().optional(),
})

const approvalsSchema = z.object({
  approved: z.boolean().optional(),
  approved_by: z.array(z.unknown()).optional(),
})

const jobSchema = z.object({
  id: z.number().optional(),
  name: z.string(),
  stage: z.string().optional(),
  status: z.string(),
  web_url: z.string(),
})

const bridgeSchema = jobSchema.extend({
  downstream_pipeline: z
    .object({
      id: z.number(),
      project_id: z.number().optional(),
    })
    .nullable()
    .optional(),
})

type GitlabJob = z.infer<typeof jobSchema>
type GitlabBridge = z.infer<typeof bridgeSchema>

type GitlabMergeRequest = z.infer<typeof mergeRequestSchema>
type GitlabPipeline = z.infer<typeof pipelineSchema>

export type GitlabTokenKind = 'oauth' | 'pat'

export function gitlabState(
  mr: Pick<GitlabMergeRequest, 'state' | 'draft' | 'work_in_progress'>,
  approvals: { approved: boolean; approvalCount: number } | null,
): RequestState {
  if (mr.state === 'merged') {
    return 'merged'
  }
  if (mr.state === 'closed' || mr.state === 'locked') {
    return 'closed'
  }
  if (mr.draft || mr.work_in_progress) {
    return 'draft'
  }
  if (approvals?.approved && approvals.approvalCount > 0) {
    return 'approved'
  }
  return approvals && approvals.approvalCount > 0 ? 'reviewed' : 'open'
}

export function gitlabCi(status: string | undefined): CiState {
  switch (status) {
    case 'success':
      return 'success'
    case 'failed':
    case 'canceled':
      return 'failure'
    case 'running':
    case 'pending':
    case 'created':
    case 'waiting_for_resource':
    case 'preparing':
    case 'scheduled':
      return 'pending'
    case 'manual':
      return 'manual'
    case 'skipped':
      return 'skipped'
    default:
      return 'none'
  }
}

function manualIsOptional(checks: readonly CiCheck[]): boolean {
  return (
    checks.some((check) => check.state === 'success') &&
    checks.every(
      (check) =>
        check.state === 'success' ||
        check.state === 'manual' ||
        check.state === 'skipped' ||
        check.state === 'none',
    )
  )
}

export function gitlabPipelineCi(status: string | undefined, checks: readonly CiCheck[]): CiState {
  const pipeline = gitlabCi(status)
  if (pipeline === 'manual' && manualIsOptional(checks)) {
    return 'success'
  }
  return pipeline
}

export class GitlabClient implements ForgeClient {
  readonly kind = 'gitlab' as const
  private readonly projectId: string

  constructor(
    readonly host: string,
    projectPath: string,
    private readonly token: string,
    private readonly fetchImpl: HttpFetch = fetch,
    private readonly tokenKind: GitlabTokenKind = 'pat',
    private readonly sleep: (ms: number) => Promise<void> = delay,
  ) {
    this.projectId = encodeURIComponent(projectPath)
  }

  private projectUrl(path: string): string {
    return this.api(`/projects/${this.projectId}${path}`)
  }

  private api(path: string): string {
    if (!isSafeHttpsHost(this.host)) {
      throw new Error('Invalid GitLab host')
    }
    return `https://${this.host}/api/v4${path}`
  }

  private call(url: string, init: RequestInit = {}): Promise<unknown> {
    return requestJson(this.fetchImpl, url, {
      ...init,
      token: this.token,
      authScheme: this.tokenKind === 'oauth' ? 'Bearer' : 'PRIVATE-TOKEN',
    })
  }

  async listRequests(
    branches: readonly string[],
    limit = DEFAULT_REQUEST_LIMIT,
  ): Promise<RequestBadge[]> {
    const [userId, listed] = await Promise.all([
      this.currentUserId(),
      this.listMergeRequests(clampRequestLimit(limit)),
    ])
    const wanted = new Set(branches)
    const mrs = listed.filter((mr) => wanted.has(mr.source_branch))
    const open = mrs.filter((mr) => mr.state === 'opened')
    const detailed = new Set(open.slice(0, DETAIL_LIMIT).map((mr) => mr.iid))
    const withJobs = new Set(
      open
        .filter((mr) => userId !== null && mr.author?.id === userId)
        .slice(0, DETAIL_LIMIT)
        .map((mr) => mr.iid),
    )
    return Promise.all(
      mrs.map((mr) => this.toBadge(mr, userId, detailed.has(mr.iid), withJobs.has(mr.iid))),
    )
  }

  private async listMergeRequests(limit: number): Promise<GitlabMergeRequest[]> {
    const collected: GitlabMergeRequest[] = []
    let page = 1
    while (collected.length < limit) {
      const pageSize = Math.min(REQUEST_PAGE_SIZE, limit - collected.length)
      const body = await this.call(
        this.projectUrl(
          `/merge_requests?state=all&order_by=updated_at&per_page=${pageSize}&page=${page}`,
        ),
      )
      const batch = z.array(mergeRequestSchema).parse(body)
      collected.push(...batch)
      if (batch.length < pageSize) {
        break
      }
      page += 1
    }
    return collected
  }

  private async currentUserId(): Promise<number | null> {
    try {
      const body = await this.call(this.api('/user'))
      return z.object({ id: z.number() }).parse(body).id
    } catch {
      return null
    }
  }

  private async toBadge(
    mr: GitlabMergeRequest,
    userId: number | null,
    withDetails: boolean,
    withJobs: boolean,
  ): Promise<RequestBadge> {
    const extra = withDetails ? await this.details(mr.iid) : null
    const listed = mr.head_pipeline ?? null
    const pipeline = listed?.id !== undefined ? listed : (extra?.pipeline ?? listed)
    const checks =
      withJobs && mr.state === 'opened' && pipeline?.id !== undefined
        ? await this.jobs(pipeline.id)
        : []
    return {
      number: mr.iid,
      title: mr.title,
      url: mr.web_url,
      state: gitlabState(mr, extra?.approvals ?? null),
      ci: gitlabPipelineCi(pipeline?.status, checks),
      isMine: userId !== null && mr.author?.id === userId,
      ...(pipeline?.web_url ? { pipelineUrl: pipeline.web_url } : {}),
      checks,
      headBranch: mr.source_branch,
      baseBranch: mr.target_branch,
    }
  }

  private async details(iid: number): Promise<{
    pipeline: GitlabPipeline | null
    approvals: { approved: boolean; approvalCount: number } | null
  }> {
    const [detail, approval] = await Promise.all([
      this.call(this.projectUrl(`/merge_requests/${iid}`)).then((body) => detailSchema.parse(body)),
      this.call(this.projectUrl(`/merge_requests/${iid}/approvals`))
        .then((body) => approvalsSchema.parse(body))
        .catch(() => null),
    ])
    return {
      pipeline: detail.head_pipeline ?? null,
      approvals: approval
        ? { approved: approval.approved ?? false, approvalCount: approval.approved_by?.length ?? 0 }
        : null,
    }
  }

  private async jobs(pipelineId: number): Promise<CiCheck[]> {
    try {
      const [jobs, bridges] = await Promise.all([
        this.listJobs(pipelineId),
        this.listBridges(pipelineId),
      ])
      const checks = byCreated([...jobs, ...bridges]).map(toCheck)
      for (const bridge of byCreated(bridges)) {
        const downstream = bridge.downstream_pipeline
        if (!downstream) {
          continue
        }
        try {
          const [childJobs, childBridges] = await Promise.all([
            this.listJobs(downstream.id, downstream.project_id),
            this.listBridges(downstream.id, downstream.project_id),
          ])
          checks.push(...byCreated([...childJobs, ...childBridges]).map(toCheck))
        } catch {
          continue
        }
      }
      return checks
    } catch {
      return []
    }
  }

  private async listJobs(pipelineId: number, projectId?: number): Promise<GitlabJob[]> {
    const collected: GitlabJob[] = []
    for (let page = 1; page <= MAX_JOB_PAGES; page += 1) {
      const body = await this.call(
        this.inProject(
          projectId,
          `/pipelines/${pipelineId}/jobs?per_page=${JOB_LIMIT}&page=${page}`,
        ),
      )
      const batch = z.array(jobSchema).parse(body)
      collected.push(...batch)
      if (batch.length < JOB_LIMIT) {
        break
      }
    }
    return collected
  }

  private async listBridges(pipelineId: number, projectId?: number): Promise<GitlabBridge[]> {
    try {
      const body = await this.call(
        this.inProject(projectId, `/pipelines/${pipelineId}/bridges?per_page=${JOB_LIMIT}`),
      )
      return z.array(bridgeSchema).parse(body)
    } catch {
      return []
    }
  }

  private inProject(projectId: number | undefined, path: string): string {
    const project = projectId === undefined ? this.projectId : encodeURIComponent(String(projectId))
    return this.api(`/projects/${project}${path}`)
  }

  async createRequest(input: CreateRequestInput): Promise<RequestBadge> {
    const init: RequestInit = {
      method: 'POST',
      body: JSON.stringify({
        source_branch: input.head,
        target_branch: input.base,
        title: input.isDraft ? `Draft: ${input.title}` : input.title,
        description: input.body,
        remove_source_branch: true,
      }),
    }
    const url = this.projectUrl('/merge_requests')
    // GitLab can reject the branch for a few seconds after a successful push.
    for (let retry = 0; ; retry += 1) {
      try {
        const mr = mergeRequestSchema.parse(await this.call(url, init))
        return {
          number: mr.iid,
          title: mr.title,
          url: mr.web_url,
          state: gitlabState(mr, null),
          ci: 'none',
          isMine: true,
          checks: [],
          headBranch: mr.source_branch,
          baseBranch: mr.target_branch,
        }
      } catch (error) {
        if (retry >= MISSING_BRANCH_RETRIES || !isMissingSourceBranch(error)) {
          throw error
        }
        await this.sleep(missingBranchDelay(retry))
      }
    }
  }

  async mergeRequest(number: number, method: MergeMethod): Promise<MergeOutcome> {
    await this.call(this.projectUrl(`/merge_requests/${number}/merge`), {
      method: 'PUT',
      body: JSON.stringify({ squash: method === 'squash', should_remove_source_branch: true }),
    })
    return 'merged'
  }

  async updateRequestBase(number: number, base: string): Promise<void> {
    await this.call(this.projectUrl(`/merge_requests/${number}`), {
      method: 'PUT',
      body: JSON.stringify({ target_branch: base }),
    })
  }
}
