import { writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { ViewState } from '../../shared/protocol'
import { JjRepo } from '../../src/jj/repo'
import { JjRunner } from '../../src/jj/runner'
import { RepoModel } from '../../src/repo/repoModel'
import { SplitSession } from '../../src/split/splitSession'
import { NULL_LOGGER } from '../../src/util/logger'

async function main(root: string, output: string): Promise<void> {
  const model = new RepoModel(new JjRepo(root, new JjRunner('jj', NULL_LOGGER)), NULL_LOGGER)
  await model.refresh()
  const state: ViewState = {
    status: 'ready',
    repos: [
      {
        id: root,
        label: basename(root),
        kind: 'jj',
        changedFiles: model.graph?.workingCopyFiles.length ?? 0,
      },
      {
        id: `${root}/tools/firmware/repo`,
        label: 'tools/firmware/repo',
        kind: 'jj',
        changedFiles: 1,
      },
    ],
    activeRepoId: root,
    graph: model.graph,
    busy: null,
    error: null,
    settings: { changeIdLength: 4, showFullPaths: false },
  }
  const target = model.graph?.commits.find(
    (c) => !c.isEmpty && c.localBookmarks.some((b) => b.name === 'main'),
  )
  const split = target
    ? await SplitSession.load(
        model.repo,
        { commitId: target.commitId, parentId: target.parents[0], description: target.description },
        await model.filesFor(target.commitId),
      )
    : null
  writeFileSync(
    output,
    `window.UKEMI_STATE = ${JSON.stringify(state)};\nwindow.UKEMI_SPLIT = ${JSON.stringify(split?.request ?? null)};\n`,
  )
}

const [root, output] = process.argv.slice(2)
if (!root || !output) {
  process.stderr.write('usage: state.js <repo> <output.js>\n')
  process.exit(2)
}
main(root, output).catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`)
  process.exit(1)
})
