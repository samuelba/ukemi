import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { CommandEnv } from '../../src/app/commands/context'
import { fileCommands } from '../../src/app/commands/fileCommands'
import { Operations } from '../../src/app/operations'
import { RepoModel } from '../../src/repo/repoModel'
import { NULL_LOGGER } from '../../src/util/logger'
import { initRepo, jj, makeRepo, makeTempDir, writeFile, type Fixture } from '../helpers/jjFixture'

let fixture: Fixture
let root: string
let model: RepoModel

beforeEach(() => {
  fixture = makeTempDir()
  root = join(fixture.dir, 'repo')
  initRepo(root)
  model = new RepoModel(makeRepo(root), NULL_LOGGER)
})

afterEach(() => fixture.cleanup())

function commands(): ReturnType<typeof fileCommands> {
  const env = {
    registry: { modelFor: () => model, activeModel: model },
    operations: new Operations(NULL_LOGGER),
    logger: NULL_LOGGER,
    ui: {
      ask: async (_level: string, _text: string, _options: unknown, action: string) => action,
      warn: async () => undefined,
      info: async () => undefined,
    },
  } as unknown as CommandEnv
  return fileCommands(env)
}

describe('discard', () => {
  test('restores both names of a renamed file', async () => {
    writeFile(root, 'old.txt', 'content that jj can follow across a rename\n')
    jj(root, 'commit', '-m', 'base')
    renameSync(join(root, 'old.txt'), join(root, 'new.txt'))
    await model.refresh()
    const renamed = model.graph?.workingCopyFiles.find((f) => f.path === 'new.txt')
    expect(renamed?.sourcePath).toBe('old.txt')

    await commands()['ukemi.file.discard']?.({ path: 'new.txt' })

    expect(existsSync(join(root, 'old.txt'))).toBe(true)
    expect(existsSync(join(root, 'new.txt'))).toBe(false)
  })
})

describe('absorb', () => {
  test('absorbs only the chosen file', async () => {
    writeFile(root, 'a.txt', 'a\n')
    writeFile(root, 'b.txt', 'b\n')
    jj(root, 'commit', '-m', 'base')
    writeFile(root, 'a.txt', 'A\n')
    writeFile(root, 'b.txt', 'B\n')
    await model.refresh()

    await commands()['ukemi.file.absorb']?.({ path: 'a.txt' })

    expect(jj(root, 'file', 'show', '-r', '@-', 'a.txt')).toBe('A\n')
    expect(jj(root, 'file', 'show', '-r', '@-', 'b.txt')).toBe('b\n')
    expect(jj(root, 'diff', '-r', '@', '--summary')).toBe('M b.txt\n')
  })
})
