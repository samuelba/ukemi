import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { FileHistoryEntry, FileHistoryHostMessage } from '../../shared/fileHistory'
import type { ChangedFile } from '../../shared/model'
import type { CommitView } from '../../shared/protocol'
import type { CommandEnv } from '../../src/app/commands/context'
import { fileHistoryCommands } from '../../src/app/commands/fileHistoryCommands'
import { loadBlame, loadFileHistory } from '../../src/app/fileHistory'
import { fileHistoryController } from '../../src/app/fileHistoryController'
import { RepoModel } from '../../src/repo/repoModel'
import { NULL_LOGGER } from '../../src/util/logger'
import { initRepo, jj, makeRepo, makeTempDir, writeFile, type Fixture } from '../helpers/jjFixture'

let fixture: Fixture
let root: string
let model: RepoModel
let diffs: { commit: CommitView; file: ChangedFile }[]
let histories: string[]

beforeEach(async () => {
  fixture = makeTempDir()
  root = join(fixture.dir, 'repo')
  initRepo(root)
  writeFile(root, 'cart.js', 'one\ntwo\n')
  writeFile(root, 'other.txt', 'x\n')
  jj(root, 'commit', '-m', 'add the cart')
  writeFile(root, 'other.txt', 'y\n')
  jj(root, 'commit', '-m', 'touch the other file')
  writeFile(root, 'cart.js', 'one\nTWO\nthree\n')
  jj(root, 'describe', '-m', 'change the cart')
  // Only the working copy is in the graph, so the older changes have to be loaded.
  model = new RepoModel(makeRepo(root), NULL_LOGGER, { revset: 'none()' })
  await model.refresh()
  diffs = []
  histories = []
})

afterEach(() => fixture.cleanup())

function env(): CommandEnv {
  return {
    registry: { modelFor: () => model, activeModel: model },
    logger: NULL_LOGGER,
    settings: { read: () => ({ changeIdLength: 4 }) },
    ui: { warn: async () => undefined, info: async () => undefined, copy: async () => {} },
    graphView: { showCommit: async () => {} },
    workbench: {
      openFileDiff: async (_model: RepoModel, commit: CommitView, file: ChangedFile) => {
        diffs.push({ commit, file })
      },
      showFileHistory: async (_model: RepoModel, path: string) => {
        histories.push(path)
      },
    },
  } as unknown as CommandEnv
}

function summaries(entries: readonly FileHistoryEntry[]): string[] {
  return entries.map((entry) => entry.summary)
}

describe('file history', () => {
  test('lists the changes that touched the file, newest first', async () => {
    const entries = await loadFileHistory(model, 'cart.js', 4)

    expect(summaries(entries)).toEqual(['change the cart', 'add the cart'])
    expect(entries[0]?.isWorkingCopy).toBe(true)
  })

  test('blames each line on the change that last touched it', async () => {
    const workingCopy = model.graph?.commits.find((commit) => commit.isWorkingCopy)
    const blame = await loadBlame(model, 'cart.js', workingCopy?.commitId ?? '', 4)

    expect(blame.text).toBe('one\nTWO\nthree\n')
    const owners = blame.runs.map((run) => [
      run.start,
      run.count,
      blame.changes[run.commitId]?.summary,
    ])
    expect(owners).toEqual([
      [1, 1, 'add the cart'],
      [2, 2, 'change the cart'],
    ])
  })

  test('a path jj does not know reports an error', async () => {
    await expect(model.repo.annotate('@', 'missing.txt')).rejects.toThrow(/No such path/)
  })

  test('opens the diff of a change the graph does not show', async () => {
    const [, older] = await loadFileHistory(model, 'cart.js', 4)
    expect(model.findCommit(older?.commitId ?? '')).toBeUndefined()

    await fileHistoryCommands(env())['ukemi.fileHistory.openDiff']?.(older)

    expect(diffs).toHaveLength(1)
    expect(diffs[0]?.commit.description.trim()).toBe('add the cart')
    expect(diffs[0]?.file).toMatchObject({ path: 'cart.js', status: 'added' })
  })

  test('Show File History passes the file to the workbench', async () => {
    await fileHistoryCommands(env())['ukemi.file.history']?.({ repoId: root, path: 'cart.js' })

    expect(histories).toEqual(['cart.js'])
  })

  test('the history tab loads the list and the blame, and diffs the selected change', async () => {
    const posted: FileHistoryHostMessage[] = []
    const documents: { commitId: string; path: string }[] = []
    const handle = fileHistoryController(
      env(),
      model,
      'cart.js',
      { post: async (message) => posted.push(message), close: () => {}, isClosed: false },
      async (_model, commit, file) => {
        documents.push({ commitId: commit.commitId, path: file.path })
        return { kind: 'files', title: commit.description, files: [] }
      },
    )

    await handle({ type: 'ready' })
    await handle({ type: 'loadBlame' })
    const loaded = posted.find((message) => message.type === 'load')
    const older = loaded?.type === 'load' ? loaded.entries[1] : undefined
    await handle({ type: 'select', commitId: older?.commitId ?? '' })
    await handle({ type: 'select', commitId: 'not-in-the-history' })

    expect(posted.map((message) => message.type)).toEqual(['load', 'blame', 'diff', 'diffError'])
    expect(documents).toEqual([{ commitId: older?.commitId, path: 'cart.js' }])
    expect(diffs).toEqual([])
  })
})
