import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

interface PlanEntry {
  path: string
  content: string | null
}

function insideRoot(root: string, path: string): string {
  const full = resolve(root, path)
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(`refusing to write outside of the diff directory: ${path}`)
  }
  return full
}

export function applyPlan(rightDir: string, entries: readonly PlanEntry[]): void {
  const root = resolve(rightDir)
  for (const entry of entries) {
    const target = insideRoot(root, entry.path)
    if (entry.content === null) {
      rmSync(target, { force: true })
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, Buffer.from(entry.content, 'base64'))
  }
}

// A plan that asks for a copy of `$left` instead of writing into `$right`.
function leftCopyTarget(plan: unknown): string | null {
  if (typeof plan !== 'object' || plan === null || !('copyLeftTo' in plan)) {
    return null
  }
  return typeof plan.copyLeftTo === 'string' ? plan.copyLeftTo : null
}

function main(argv: readonly string[]): number {
  const [left, right, planFile] = argv
  if (!left || !right || !planFile) {
    process.stderr.write('usage: splitTool <left> <right> <plan.json>\n')
    return 2
  }
  const plan: unknown = JSON.parse(readFileSync(planFile, 'utf8'))
  const copyTo = leftCopyTarget(plan)
  if (copyTo !== null) {
    cpSync(left, copyTo, { recursive: true })
    return 0
  }
  if (!Array.isArray(plan)) {
    process.stderr.write('invalid split plan\n')
    return 2
  }
  applyPlan(right, plan as PlanEntry[])
  return 0
}

if (process.env.UKEMI_SPLIT_TOOL === '1') {
  process.exitCode = main(process.argv.slice(2))
}
