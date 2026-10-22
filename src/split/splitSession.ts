import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChangedFile } from '../../shared/model'
import type { SplitFile, SplitRequest, SplitSelection } from '../../shared/split'
import type { JjRepo } from '../jj/repo'
import { computeSegments } from './hunks'
import { buildPlan, type FileContents } from './plan'

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
  parentId: string | undefined
  description: string
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
  ): Promise<SplitSession> {
    const contents = new Map<string, FileContents>()
    const splitFiles: SplitFile[] = await Promise.all(
      files.map(async (file) => {
        const left =
          file.status === 'added' ? null : await readOrNull(repo, commit.parentId, file.sourcePath)
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
    tool: { wrapperPath: string; workDir: string },
    message: string,
    selections: readonly SplitSelection[],
  ): Promise<void> {
    const plan = buildPlan(this.request.files, this.contents, selections)
    const dir = await mkdtemp(join(tool.workDir, 'split-'))
    const planPath = join(dir, 'plan.json')
    try {
      await writeFile(planPath, JSON.stringify(plan))
      const config = [
        `--config=merge-tools.ukemi-split.program=${JSON.stringify(tool.wrapperPath)}`,
        `--config=merge-tools.ukemi-split.edit-args=${JSON.stringify(['$left', '$right', planPath])}`,
      ]
      await repo.splitWithTool(this.request.commitId, config, message)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

export function wrapperScript(nodePath: string, toolArgs: readonly string[]): string {
  const quoted = [nodePath, ...toolArgs].map((arg) => `'${arg.replace(/'/g, `'\\''`)}'`).join(' ')
  return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 UKEMI_SPLIT_TOOL=1 exec ${quoted} "$@"\n`
}
