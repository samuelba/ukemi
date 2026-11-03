import type { ChangedFile } from '../../shared/model'
import type { SplitFile, SplitRequest, SplitSelection } from '../../shared/split'
import type { JjRepo } from '../jj/repo'
import { computeSegments } from './hunks'
import { buildPlan, type FileContents } from './plan'
import { readLeftWithTool, withPlanTool, type ToolWrapper } from './toolRun'

const BINARY_PROBE_BYTES = 8000

function isBinary(data: Buffer | null): boolean {
  return data !== null && data.subarray(0, BINARY_PROBE_BYTES).includes(0)
}

async function readOrNull(
  repo: JjRepo,
  commitId: string | undefined,
  path: string,
): Promise<Buffer | null> {
  if (!commitId) {
    return null
  }
  try {
    return await repo.fileContent(commitId, path)
  } catch {
    return null
  }
}

export interface SplitCommitInfo {
  commitId: string
  parentIds: readonly string[]
  description: string
}

// The files as the commit's parents have them. jj splits a merge against the merge of its parents,
// which only jj's diff tool sees.
async function leftSides(
  repo: JjRepo,
  tool: ToolWrapper,
  commit: SplitCommitInfo,
  files: readonly ChangedFile[],
): Promise<ReadonlyMap<string, Buffer | null>> {
  const paths = files.filter((file) => file.status !== 'added').map((file) => file.sourcePath)
  if (commit.parentIds.length > 1) {
    return readLeftWithTool(tool, paths, (config) =>
      repo.diffWithTool(commit.commitId, paths, config),
    )
  }
  const parent = commit.parentIds[0]
  const entries = await Promise.all(
    paths.map(async (path) => [path, await readOrNull(repo, parent, path)] as const),
  )
  return new Map(entries)
}

export class SplitSession {
  private constructor(
    readonly request: SplitRequest,
    private readonly contents: ReadonlyMap<string, FileContents>,
  ) {}

  static async load(
    repo: JjRepo,
    commit: SplitCommitInfo,
    files: readonly ChangedFile[],
    tool: ToolWrapper,
  ): Promise<SplitSession> {
    const contents = new Map<string, FileContents>()
    const lefts = await leftSides(repo, tool, commit, files)
    const splitFiles: SplitFile[] = await Promise.all(
      files.map(async (file) => {
        const left = file.status === 'added' ? null : (lefts.get(file.sourcePath) ?? null)
        const right =
          file.status === 'removed' ? null : await readOrNull(repo, commit.commitId, file.path)
        contents.set(file.path, { left, right })
        const binary = isBinary(left) || isBinary(right)
        return {
          path: file.path,
          sourcePath: file.sourcePath,
          status: file.status,
          isBinary: binary,
          segments: binary
            ? []
            : computeSegments(left?.toString('utf8') ?? '', right?.toString('utf8') ?? ''),
        }
      }),
    )
    return new SplitSession(
      {
        commitId: commit.commitId,
        title: commit.description.split('\n')[0] ?? '',
        description: commit.description,
        files: splitFiles,
      },
      contents,
    )
  }

  async apply(
    repo: JjRepo,
    tool: ToolWrapper,
    message: string,
    selections: readonly SplitSelection[],
  ): Promise<void> {
    const plan = buildPlan(this.request.files, this.contents, selections)
    await withPlanTool(tool, plan, (config) =>
      repo.splitWithTool(this.request.commitId, config, message),
    )
  }
}
