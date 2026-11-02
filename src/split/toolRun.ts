import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
      `--config=merge-tools.ukemi-split.program=${JSON.stringify(tool.wrapperPath)}`,
      `--config=merge-tools.ukemi-split.edit-args=${JSON.stringify(['$left', '$right', planPath])}`,
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
