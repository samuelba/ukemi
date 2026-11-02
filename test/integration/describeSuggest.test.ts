import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { CommitView } from '../../shared/protocol'
import { DescriptionSuggestions } from '../../src/app/describeSuggest/service'
import { CliSuggester, SuggestionCancelled } from '../../src/app/describeSuggest/suggesters'
import { readSettings, type Settings } from '../../src/app/settings'
import type { JjRepo } from '../../src/jj/repo'
import type { RepoModel } from '../../src/repo/repoModel'
import { initRepo, jj, makeRepo, makeTempDir, writeFile, type Fixture } from '../helpers/jjFixture'

let fixture: Fixture
let root: string
let repo: JjRepo

beforeEach(() => {
  fixture = makeTempDir()
  root = join(fixture.dir, 'repo')
  initRepo(root)
  repo = makeRepo(root)
  writeFile(root, 'a.txt', 'one\n')
  jj(root, 'describe', '-m', 'feat: add a')
  jj(root, 'new')
  writeFile(root, 'a.txt', 'two\n')
  writeFile(root, 'b.txt', 'bee\n')
  jj(root, 'status')
})

afterEach(() => fixture.cleanup())

function workingCopyId(): string {
  return jj(root, 'log', '--no-graph', '-r', '@', '-T', 'commit_id').trim()
}

describe('repo reads for suggestions', () => {
  test('diffGit and diffStat describe one change', async () => {
    const id = workingCopyId()

    const diff = await repo.diffGit(id)
    expect(diff).toContain('diff --git a/a.txt b/a.txt')
    expect(diff).toContain('+two')
    expect(diff).toContain('diff --git a/b.txt b/b.txt')
    expect(await repo.diffStat(id)).toMatch(/2 files changed/)
  })

  test('ancestorDescriptions lists non-empty descriptions, newest first', async () => {
    jj(root, 'describe', '-m', 'fix: change a')
    jj(root, 'new')
    jj(root, 'new')

    const id = workingCopyId()
    expect(await repo.ancestorDescriptions(id, 10)).toEqual(['fix: change a', 'feat: add a'])
    expect(await repo.ancestorDescriptions(id, 1)).toEqual([])
  })
})

// A stand-in for a coding agent CLI: it answers with a fixed description and keeps the prompt.
function fakeTool(dir: string, body: string): string {
  const path = join(dir, 'fake-tool')
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

function settings(): Settings {
  const config = readSettings({ get: <T>(_key: string, fallback: T) => fallback })
  return { read: () => ({ ...config, suggestTools: ['claude'] }) } as unknown as Settings
}

function workingCopy(): { model: RepoModel; commit: CommitView } {
  return {
    model: { root, repo } as unknown as RepoModel,
    commit: { commitId: workingCopyId(), description: '' } as CommitView,
  }
}

describe('suggesting a description', () => {
  test('sends the diff to the tool and returns its answer', async () => {
    const promptFile = join(fixture.dir, 'prompt.txt')
    const binary = fakeTool(fixture.dir, `cat > "${promptFile}"\necho 'feat: change a, add b'`)
    const suggester = new CliSuggester(
      {
        id: 'claude',
        label: 'Fake',
        binary,
        invocation: (prompt) => ({ args: [], stdin: prompt }),
      },
      () => ({ model: '' }),
    )
    const service = new DescriptionSuggestions([suggester], settings())
    const { model, commit } = workingCopy()

    expect(await suggester.available()).toBe(true)
    expect(await service.suggest(model, commit, 'claude', 'r1')).toBe('feat: change a, add b')
    const prompt = readFileSync(promptFile, 'utf8')
    expect(prompt).toContain('+two')
    expect(prompt).toContain('feat: add a')
  })

  test('stops the tool when the request is cancelled', async () => {
    const binary = fakeTool(fixture.dir, 'sleep 30')
    const suggester = new CliSuggester(
      { id: 'claude', label: 'Fake', binary, invocation: () => ({ args: [] }) },
      () => ({ model: '' }),
    )
    const service = new DescriptionSuggestions([suggester], settings())
    const { model, commit } = workingCopy()

    const started = Date.now()
    const result = service.suggest(model, commit, 'claude', 'r1')
    setTimeout(() => service.cancel('r1'), 300)

    await expect(result).rejects.toBeInstanceOf(SuggestionCancelled)
    expect(Date.now() - started).toBeLessThan(10_000)
  })
})
