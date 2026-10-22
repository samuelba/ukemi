import { z } from 'zod'
import type { CiState, RequestBadge, RequestState } from '../../shared/protocol'
import { requestJson, type CreateRequestInput, type ForgeClient, type HttpFetch, type MergeMethod } from './types'

const LIST_LIMIT = 50
const DETAIL_LIMIT = 10

const mergeRequestSchema = z.object({
  iid: z.number(),
  title: z.string(),
  web_url: z.string(),
  state: z.string(),
  draft: z.boolean().optional(),
  work_in_progress: z.boolean().optional(),
  source_branch: z.string(),
  target_branch: z.string(),
})

const detailSchema = z.object({
  head_pipeline: z.object({ status: z.string() }).nullable().optional(),
})

const approvalsSchema = z.object({
  approved: z.boolean().optional(),
  approved_by: z.array(z.unknown()).optional(),
})

type GitlabMergeRequest = z.infer<typeof mergeRequestSchema>

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
    case 'manual':
      return 'pending'
    default:
      return 'none'
  }
}

export class GitlabClient implements ForgeClient {
  readonly kind = 'gitlab' as const
  private readonly projectId: string

  constructor(
    readonly host: string,
    projectPath: string,
    private readonly token: string,
    private readonly fetchImpl: HttpFetch = fetch,
  ) {
    this.projectId = encodeURIComponent(projectPath)
  }

  private url(path: string): string {
    return `https://${this.host}/api/v4/projects/${this.projectId}${path}`
  }

  private call(url: string, init: RequestInit = {}): Promise<unknown> {
    return requestJson(this.fetchImpl, url, { ...init, token: this.token, authScheme: 'PRIVATE-TOKEN' })
  }

  async listRequests(branches: readonly string[]): Promise<RequestBadge[]> {
    const body = await this.call(
      this.url(`/merge_requests?state=all&order_by=updated_at&per_page=${LIST_LIMIT}`),
    )
    const wanted = new Set(branches)
    const mrs = z.array(mergeRequestSchema).parse(body).filter((mr) => wanted.has(mr.source_branch))
    const detailed = new Set(mrs.filter((mr) => mr.state === 'opened').slice(0, DETAIL_LIMIT).map((mr) => mr.iid))
    return Promise.all(mrs.map((mr) => this.toBadge(mr, detailed.has(mr.iid))))
  }

  private async toBadge(mr: GitlabMergeRequest, withDetails: boolean): Promise<RequestBadge> {
    let ci: CiState = 'none'
    let approvals: { approved: boolean; approvalCount: number } | null = null
    if (withDetails) {
      const [detail, approval] = await Promise.all([
        this.call(this.url(`/merge_requests/${mr.iid}`)).then((b) => detailSchema.parse(b)),
        this.call(this.url(`/merge_requests/${mr.iid}/approvals`))
          .then((b) => approvalsSchema.parse(b))
          .catch(() => null),
      ])
      ci = gitlabCi(detail.head_pipeline?.status)
      approvals = approval
        ? { approved: approval.approved ?? false, approvalCount: approval.approved_by?.length ?? 0 }
        : null
    }
    return {
      number: mr.iid,
      title: mr.title,
      url: mr.web_url,
      state: gitlabState(mr, approvals),
      ci,
      headBranch: mr.source_branch,
      baseBranch: mr.target_branch,
    }
  }

  async createRequest(input: CreateRequestInput): Promise<RequestBadge> {
    const body = await this.call(this.url('/merge_requests'), {
      method: 'POST',
      body: JSON.stringify({
        source_branch: input.head,
        target_branch: input.base,
        title: input.isDraft ? `Draft: ${input.title}` : input.title,
        description: input.body,
        remove_source_branch: true,
      }),
    })
    const mr = mergeRequestSchema.parse(body)
    return {
      number: mr.iid,
      title: mr.title,
      url: mr.web_url,
      state: gitlabState(mr, null),
      ci: 'none',
      headBranch: mr.source_branch,
      baseBranch: mr.target_branch,
    }
  }

  async mergeRequest(number: number, method: MergeMethod): Promise<void> {
    await this.call(this.url(`/merge_requests/${number}/merge`), {
      method: 'PUT',
      body: JSON.stringify({ squash: method === 'squash', should_remove_source_branch: true }),
    })
  }
}
