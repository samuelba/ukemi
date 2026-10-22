import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { JjRepo } from '../../src/jj/repo'
import { SplitSession, wrapperScript } from '../../src/split/splitSession'
import { applyPlan } from '../../src/split/splitTool'
import { initRepo, jj, makeRepo, makeTempDir, writeFile, type Fixture } from '../helpers/jjFixture'

let fixture: Fixture
let root: string
let repo: JjRepo
let tool: { wrapperPath: string; workDir: string }

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

async function sessionFor(revset: string) {
  await repo.snapshot()
  const [commit] = await repo.log(revset)
  if (!commit) {
    throw new Error('missing commit')
  }
  const files = await repo.files(commit.commitId)
  return {
    commit,
    session: await SplitSession.load(
      repo,
      { commitId: commit.commitId, parentId: commit.parents[0], description: commit.description },
      files,
    ),
  }
}

describe('applyPlan', () => {
  test('refuses paths outside of the target directory', () => {
    expect(() => applyPlan(fixture.dir, [{ path: '../escape', content: '' }])).toThrow('refusing')
  })
})

describe('SplitSession', () => {
  test('moves one selected hunk into a new change below', async () => {
    writeFile(root, 'a.txt', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n')
    jj(root, 'new')
    writeFile(root, 'a.txt', 'ONE\ntwo\nthree\nfour\nfive\nsix\nSEVEN\n')
    writeFile(root, 'b.txt', 'b\n')
    jj(root, 'describe', '-m', 'mixed work')
    const { session } = await sessionFor('@')
    const fileA = session.request.files.find((f) => f.path === 'a.txt')
    expect(fileA?.segments.filter((s) => s.kind === 'change')).toHaveLength(2)

    await session.apply(repo, tool, 'first part', [{ path: 'a.txt', hunks: [0], isWholeFile: false }])

    const [top, bottom] = await repo.log('@ | @-')
    expect(bottom?.description).toBe('first part\n')
    expect(top?.description).toBe('mixed work\n')
    expect((await repo.fileContent(bottom?.commitId ?? '', 'a.txt')).toString()).toBe(
      'ONE\ntwo\nthree\nfour\nfive\nsix\nseven\n',
    )
    expect((await repo.files(bottom?.commitId ?? '')).map((f) => f.path)).toEqual(['a.txt'])
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('ONE\ntwo\nthree\nfour\nfive\nsix\nSEVEN\n')
  })

  test('moves a whole added file', async () => {
    writeFile(root, 'keep.txt', 'k\n')
    writeFile(root, 'move.txt', 'm\n')
    const { session } = await sessionFor('@')

    await session.apply(repo, tool, 'moved', [{ path: 'move.txt', hunks: [], isWholeFile: true }])

    const [top, bottom] = await repo.log('@ | @-')
    expect((await repo.files(bottom?.commitId ?? '')).map((f) => f.path)).toEqual(['move.txt'])
    expect((await repo.files(top?.commitId ?? '')).map((f) => f.path)).toEqual(['keep.txt'])
  })
})
