import { existsSync, readFileSync, renameSync, statSync } from 'node:fs'
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
let declines: boolean

beforeEach(() => {
  fixture = makeTempDir()
  root = join(fixture.dir, 'repo')
  initRepo(root)
  model = new RepoModel(makeRepo(root), NULL_LOGGER)
  declines = false
})

afterEach(() => fixture.cleanup())

function commands(): ReturnType<typeof fileCommands> {
  const env = {
    registry: { modelFor: () => model, activeModel: model },
    operations: new Operations(NULL_LOGGER),
    logger: NULL_LOGGER,
    ui: {
      ask: async (_level: string, _text: string, _options: unknown, action: string) =>
        declines ? undefined : action,
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

describe('chmod', () => {
  function executable(revset: string): string {
    return jj(root, 'file', 'list', '-r', revset, '-T', 'path ++ "=" ++ executable ++ "\\n"')
  }

  test.skipIf(process.platform === 'win32')(
    'sets and clears the bit in the working copy',
    async () => {
      writeFile(root, 'run.sh', 'echo hi\n')
      await model.refresh()

      await commands()['ukemi.file.makeExecutable']?.({ path: 'run.sh' })
      expect(statSync(join(root, 'run.sh')).mode & 0o111).not.toBe(0)
      expect(executable('@')).toBe('run.sh=true\n')

      await commands()['ukemi.file.makeNonExecutable']?.({ path: 'run.sh' })
      expect(statSync(join(root, 'run.sh')).mode & 0o111).toBe(0)
    },
  )

  test('changes the bit in a change below the working copy', async () => {
    writeFile(root, 'run.sh', 'echo hi\n')
    jj(root, 'commit', '-m', 'script')
    await model.refresh()
    const parent = model.graph?.commits.find((c) => !c.isWorkingCopy && !c.isImmutable)

    await commands()['ukemi.file.makeExecutable']?.({ commitId: parent?.commitId, path: 'run.sh' })

    expect(executable('@-')).toBe('run.sh=true\n')
  })
})

describe('untrack', () => {
  function tracked(): string {
    return jj(root, 'file', 'list', '-r', '@')
  }

  beforeEach(async () => {
    writeFile(root, 'keep.txt', 'keep\n')
    writeFile(root, 'secret.env', 'TOKEN=1\n')
    jj(root, 'commit', '-m', 'oops')
    await model.refresh()
  })

  test('untracks an ignored file and keeps it on disk', async () => {
    writeFile(root, '.gitignore', 'secret.env\n')
    await model.refresh()

    await commands()['ukemi.file.untrack']?.({ path: 'secret.env' })

    expect(tracked()).toBe('.gitignore\nkeep.txt\n')
    expect(existsSync(join(root, 'secret.env'))).toBe(true)
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('secret.env\n')
  })

  test('adds a file that is not ignored to .gitignore first', async () => {
    await commands()['ukemi.file.untrack']?.({ path: 'secret.env' })

    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('/secret.env\n')
    expect(tracked()).toBe('.gitignore\nkeep.txt\n')
    expect(existsSync(join(root, 'secret.env'))).toBe(true)
    expect(jj(root, 'diff', '-r', '@', '--summary')).toBe('A .gitignore\nD secret.env\n')
  })

  test('changes nothing when the user declines', async () => {
    declines = true

    await commands()['ukemi.file.untrack']?.({ path: 'secret.env' })

    expect(existsSync(join(root, '.gitignore'))).toBe(false)
    expect(tracked()).toBe('keep.txt\nsecret.env\n')
  })
})
