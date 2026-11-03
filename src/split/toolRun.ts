import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeWrapperScript } from '../util/nodeWrapper'
import type { PlanEntry } from './plan'

export interface SplitToolPaths {
  // Where the wrapper script for jj's diff editor is written.
  storageDir: string
  // The bundled `splitTool.js`.
  toolPath: string
}

export interface ToolWrapper {
  wrapperPath: string
  workDir: string
}

export function wrapperScript(nodePath: string, toolArgs: readonly string[]): string {
  return nodeWrapperScript(nodePath, toolArgs, 'UKEMI_SPLIT_TOOL')
}

export async function ensureWrapper(paths: SplitToolPaths): Promise<ToolWrapper> {
  await mkdir(paths.storageDir, { recursive: true })
  const wrapperPath = join(paths.storageDir, 'ukemi-split.sh')
  await writeFile(wrapperPath, wrapperScript(process.execPath, [paths.toolPath]))
  await chmod(wrapperPath, 0o755)
  return { wrapperPath, workDir: paths.storageDir }
}

function programConfig(tool: ToolWrapper): string {
  return `--config=merge-tools.ukemi-split.program=${JSON.stringify(tool.wrapperPath)}`
}

// Hands `run` the `--config` args that make `ukemi-split`, as jj's diff tool, copy `$left` into a
// temp folder, and reads the paths from there. For a merge, `$left` is the merge of the parents,
// which no single revision holds. A path that is missing on the left side reads as null.
export async function readLeftWithTool(
  tool: ToolWrapper,
  paths: readonly string[],
  run: (config: readonly string[]) => Promise<unknown>,
): Promise<Map<string, Buffer | null>> {
  const dir = await mkdtemp(join(tool.workDir, 'left-'))
  const planPath = join(dir, 'plan.json')
  const copy = join(dir, 'left')
  try {
    await writeFile(planPath, JSON.stringify({ copyLeftTo: copy }))
    await run([
      programConfig(tool),
      `--config=merge-tools.ukemi-split.diff-args=${JSON.stringify(['$left', '$right', planPath])}`,
    ])
    const entries = await Promise.all(
      paths.map(
        async (path) => [path, await readFile(join(copy, path)).catch(() => null)] as const,
      ),
    )
    return new Map(entries)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// Writes the plan to a temp file and hands `run` the `--config` args that make `ukemi-split`
// write the plan's files into jj's `$right` directory.
export async function withPlanTool<T>(
  tool: ToolWrapper,
  plan: readonly PlanEntry[],
  run: (config: readonly string[]) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tool.workDir, 'plan-'))
  const planPath = join(dir, 'plan.json')
  try {
    await writeFile(planPath, JSON.stringify(plan))
    return await run([
      programConfig(tool),
      `--config=merge-tools.ukemi-split.edit-args=${JSON.stringify(['$left', '$right', planPath])}`,
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
