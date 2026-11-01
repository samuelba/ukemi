import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { JjRepo } from '../../src/jj/repo'
import { withPlanTool, wrapperScript, type ToolWrapper } from '../../src/split/toolRun'
import { initRepo, jj, makeRepo, makeTempDir, writeFile, type Fixture } from '../helpers/jjFixture'

let fixture: Fixture
let root: string
let repo: JjRepo
let tool: ToolWrapper

beforeEach(() => {
  fixture = makeTempDir()
  root = join(fixture.dir, 'repo')
  initRepo(root)
  repo = makeRepo(root)
  const workDir = join(fixture.dir, 'work')
  mkdirSync(workDir)
  const wrapperPath = join(workDir, 'ukemi-split.sh')
  const toolSource = resolve(__dirname, '../../src/split/splitTool.ts')
  writeFileSync(
    wrapperPath,
    wrapperScript(process.execPath, ['--experimental-strip-types', '--no-warnings', toolSource]),
  )
  chmodSync(wrapperPath, 0o755)
  tool = { wrapperPath, workDir }
})

afterEach(() => fixture.cleanup())

function changeId(revset: string): string {
  return jj(root, 'log', '-r', revset, '--no-graph', '-T', 'change_id').trim()
}

function commitId(revset: string): string {
  return jj(root, 'log', '-r', revset, '--no-graph', '-T', 'commit_id').trim()
}

function conflicted(): string[] {
  const out = jj(
    root,
    'log',
    '-r',
    'conflicts()',
    '--no-graph',
    '-T',
    'description.first_line() ++ "\\n"',
  )
  return out.split('\n').filter(Boolean)
}

// base → one side per text, merged into `merge`, with `child` and an empty `@` on top.
function mergeConflict(sides: readonly string[]): string {
  writeFile(root, 'f.txt', 'a\nb\nc\n')
  jj(root, 'commit', '-m', 'base')
  const base = changeId('@-')
  const heads = sides.map((side) => {
    jj(root, 'new', base, '-m', `side ${side}`)
    writeFile(root, 'f.txt', `a\n${side}\nc\n`)
    return changeId('@')
  })
  jj(root, 'new', ...heads, '-m', 'merge')
  const merge = changeId('@')
  jj(root, 'new', '-m', 'child')
  writeFile(root, 'g.txt', 'g\n')
  jj(root, 'new', '-m', 'wc')
  return merge
}

async function write(change: string, content: string): Promise<void> {
  const plan = [{ path: 'f.txt', content: Buffer.from(content).toString('base64') }]
  await withPlanTool(tool, plan, (config) =>
    repo.writeFilesWithTool(commitId(change), ['f.txt'], config),
  )
}

describe('writeFilesWithTool', () => {
  test('resolves a conflicted merge commit and its descendants', async () => {
    const merge = mergeConflict(['MINE', 'THEIRS'])
    expect(conflicted()).toEqual(['wc', 'child', 'merge'])

    await write(merge, 'a\nRESOLVED\nc\n')

    expect(conflicted()).toEqual([])
    expect(jj(root, 'file', 'show', '-r', merge, 'f.txt')).toBe('a\nRESOLVED\nc\n')
    expect(jj(root, 'log', '-r', '@', '--no-graph', '-T', 'description')).toBe('wc\n')
  })

  test('keeps a conflict whose markers are left in the text', async () => {
    const merge = mergeConflict(['MINE', 'THEIRS'])
    const text = jj(root, 'file', 'show', '-r', merge, 'f.txt').replace(/^c$/m, 'C')

    await write(merge, text)

    expect(conflicted()).toEqual(['wc', 'child', 'merge'])
    expect(jj(root, 'file', 'show', '-r', merge, 'f.txt')).toContain('\nC\n')
    expect(jj(root, 'resolve', '--list', '-r', merge)).toContain('2-sided conflict')
  })

  test('resolves a 3-sided conflict', async () => {
    const merge = mergeConflict(['ONE', 'TWO', 'THREE'])
    expect(jj(root, 'resolve', '--list', '-r', merge)).toContain('3-sided conflict')

    await write(merge, 'a\nALL\nc\n')

    expect(conflicted()).toEqual([])
  })
})

describe('resolveWithBuiltin', () => {
  test('takes side #2 of a 2-sided conflict', async () => {
    const merge = mergeConflict(['MINE', 'THEIRS'])

    await repo.resolveWithBuiltin(commitId(merge), 'f.txt', ':theirs')

    expect(conflicted()).toEqual([])
    expect(jj(root, 'file', 'show', '-r', merge, 'f.txt')).toBe('a\nTHEIRS\nc\n')
  })

  test('refuses a 3-sided conflict', async () => {
    const merge = mergeConflict(['ONE', 'TWO', 'THREE'])

    await expect(repo.resolveWithBuiltin(commitId(merge), 'f.txt', ':ours')).rejects.toThrow(
      /3 sides/,
    )
  })
})
