import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { EditorHostMessage, EditorState } from '../../shared/editor'
import type { CommandEnv } from '../../src/app/commands/context'
import { decodeFile, editorController, MAX_EDIT_BYTES } from '../../src/app/editorController'
import { Operations } from '../../src/app/operations'
import type { PanelChannel, PanelHandler } from '../../src/app/panel'
import { RepoModel } from '../../src/repo/repoModel'
import { NULL_LOGGER } from '../../src/util/logger'
import { initRepo, jj, makeRepo, makeTempDir, writeFile, type Fixture } from '../helpers/jjFixture'

let fixture: Fixture
let root: string
let model: RepoModel
let posts: EditorHostMessage[]
let answers: (string | undefined)[]
let asked: string[]
let closed: boolean

beforeEach(() => {
  fixture = makeTempDir()
  root = join(fixture.dir, 'repo')
  initRepo(root)
  model = new RepoModel(makeRepo(root), NULL_LOGGER)
  posts = []
  answers = []
  asked = []
  closed = false
})

afterEach(() => fixture.cleanup())

function open(path: string, revset = '@'): PanelHandler<unknown> {
  const changeId = jj(root, 'log', '-r', revset, '--no-graph', '-T', 'change_id').trim()
  const channel: PanelChannel<EditorHostMessage> = {
    post: async (message) => posts.push(message),
    close: () => {
      closed = true
    },
    get isClosed() {
      return closed
    },
  }
  const env = {
    operations: new Operations(NULL_LOGGER),
    logger: NULL_LOGGER,
    ui: {
      ask: async (_level: string, text: string) => {
        asked.push(text)
        return answers.shift()
      },
    },
    workbench: { openFileExternally: async () => undefined },
  } as unknown as CommandEnv
  const paths = {
    storageDir: join(fixture.dir, 'tool'),
    toolPath: resolve(__dirname, '../../src/split/splitTool.ts'),
  }
  return editorController(env, { model, changeId, path }, channel, paths) as PanelHandler<unknown>
}

function lastState(): EditorState {
  const load = posts.filter((m) => m.type === 'load').at(-1)
  if (!load || load.type !== 'load') {
    throw new Error(`no load in ${JSON.stringify(posts)}`)
  }
  return load.state
}

function mergeConflict(): void {
  writeFile(root, 'f.txt', 'a\nb\nc\n')
  jj(root, 'commit', '-m', 'base')
  const base = jj(root, 'log', '-r', '@-', '--no-graph', '-T', 'change_id').trim()
  jj(root, 'new', base, '-m', 'mine')
  writeFile(root, 'f.txt', 'a\nMINE\nc\n')
  jj(root, 'new', base, '-m', 'theirs')
  writeFile(root, 'f.txt', 'a\nTHEIRS\nc\n')
  jj(root, 'new', 'description(exact:"mine\n")', '@', '-m', 'merge')
  jj(root, 'new', '-m', 'wc')
}

describe('editorController', () => {
  test('loads a working-copy file from disk', async () => {
    writeFile(root, 'a.txt', 'hello\n')
    const handler = open('a.txt')

    await handler({ type: 'ready' })

    const state = lastState()
    expect(state.text).toBe('hello\n')
    expect(state.isWorkingCopy).toBe(true)
    expect(state.readOnly).toBeNull()
  })

  test('saves the working copy on disk and snapshots it', async () => {
    writeFile(root, 'a.txt', 'hello\n')
    const handler = open('a.txt')
    await handler({ type: 'ready' })

    await handler({ type: 'save', text: 'edited\n', baseHash: lastState().baseHash })

    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('edited\n')
    expect(jj(root, 'file', 'show', '-r', '@', '--ignore-working-copy', 'a.txt')).toBe('edited\n')
    expect(lastState().text).toBe('edited\n')
  })

  test('asks before overwriting a file that changed on disk, and can reload', async () => {
    writeFile(root, 'a.txt', 'one\n')
    const handler = open('a.txt')
    await handler({ type: 'ready' })
    const baseHash = lastState().baseHash
    writeFileSync(join(root, 'a.txt'), 'changed elsewhere\n')
    answers.push('Reload')

    await handler({ type: 'save', text: 'mine\n', baseHash })

    expect(asked).toEqual(['a.txt changed since it was opened.'])
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('changed elsewhere\n')
    expect(lastState().text).toBe('changed elsewhere\n')
  })

  test('resolves a conflict in a change below the working copy', async () => {
    mergeConflict()
    const handler = open('f.txt', 'description(exact:"merge\n")')
    await handler({ type: 'ready' })
    const state = lastState()
    expect(state.isWorkingCopy).toBe(false)
    expect(state.conflictedPaths).toEqual(['f.txt'])
    expect(state.text).toContain('<<<<<<<')

    await handler({ type: 'save', text: 'a\nBOTH\nc\n', baseHash: state.baseHash })

    expect(jj(root, 'log', '-r', 'conflicts()', '--no-graph', '-T', 'description')).toBe('')
    const after = lastState()
    expect(after.text).toBe('a\nBOTH\nc\n')
    expect(after.conflictedPaths).toEqual([])
    expect(after.commitId).not.toBe(state.commitId)
  })

  test('refuses to switch to a path that is not conflicted', async () => {
    writeFile(root, 'a.txt', 'a\n')
    const handler = open('a.txt')
    await handler({ type: 'ready' })

    await handler({ type: 'openPath', path: '../outside', isDirty: false })

    expect(posts.at(-1)).toEqual({
      type: 'error',
      text: '../outside is not a conflicted file of this change.',
    })
  })

  test('opens an immutable change read-only', async () => {
    writeFile(root, 'a.txt', 'a\n')
    jj(root, 'commit', '-m', 'base')
    const handler = open('a.txt', 'root()')

    await handler({ type: 'ready' })

    expect(lastState().readOnly).toMatch(/immutable/)
  })

  test('asks before closing with edits', async () => {
    writeFile(root, 'a.txt', 'a\n')
    const handler = open('a.txt')
    answers.push(undefined)

    await handler({ type: 'close', isDirty: true })
    expect(closed).toBe(false)

    await handler({ type: 'close', isDirty: false })
    expect(closed).toBe(true)
  })

  test('ignores malformed messages', async () => {
    const handler = open('a.txt')

    await handler({ type: 'save', text: 42 })

    expect(posts).toEqual([])
  })
})

describe('decodeFile', () => {
  test('makes binary and large files read-only', () => {
    expect(decodeFile(Buffer.from([1, 0, 2])).readOnly).toMatch(/binary/)
    expect(decodeFile(Buffer.alloc(MAX_EDIT_BYTES + 1, 97)).readOnly).toMatch(/too large/)
    expect(decodeFile(Buffer.from('ok')).text).toBe('ok')
  })
})
