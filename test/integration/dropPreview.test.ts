import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { NEW_PREFIX, previewDrop, type PreviewDrop } from '../../shared/dropPreview'
import type { CommitView } from '../../shared/protocol'
import { RepoModel } from '../../src/repo/repoModel'
import { NULL_LOGGER } from '../../src/util/logger'
import { initRepo, jj, makeRepo, makeTempDir, type Fixture } from '../helpers/jjFixture'

// The preview works out a drop without jj. These tests run the drop for real and compare.

let fixture: Fixture
let root: string

beforeEach(() => {
  fixture = makeTempDir()
  root = join(fixture.dir, 'repo')
  initRepo(root)
})

afterEach(() => fixture.cleanup())

const exact = (name: string) => `description(exact:"${name}\n")`

//   wc  u            the working copy on u, which is on t
//   h                a second head on x
//   t
//   m                a merge of y and o
//   o
//   y
//   x
//   b
//   a
function buildGraph(): void {
  jj(root, 'describe', '-m', 'a')
  const add = (name: string, ...parents: string[]) =>
    jj(root, 'new', '-m', name, ...parents.map(exact))
  add('b', 'a')
  add('x', 'b')
  add('y', 'x')
  add('o', 'a')
  add('m', 'y', 'o')
  add('t', 'a')
  add('h', 'x')
  add('u', 't')
  add('wc', 'u')
}

async function graphOf(revset: string): Promise<CommitView[]> {
  const model = new RepoModel(makeRepo(root), NULL_LOGGER, { revset })
  await model.refresh()
  expect(model.error).toBeNull()
  return model.graph?.commits ?? []
}

const nameOf = (commits: readonly CommitView[]) => {
  const names = new Map(commits.map((c) => [c.commitId, c.description.trim() || 'root']))
  // A copy in the preview is named after the change it copies, as jj copies the description.
  return (id: string) => names.get(id.replace(NEW_PREFIX, '')) ?? `?${id.slice(0, 8)}`
}

// Each row as "name <- parents", sorted, so copies with the same name still compare.
function shape(
  rows: readonly { commitId: string; edges: readonly { id: string; isElided: boolean }[] }[],
  name: (id: string) => string,
): string[] {
  return rows
    .map((row) => {
      const parents = row.edges.map((e) => `${e.isElided ? '~' : ''}${name(e.id)}`).sort()
      return `${name(row.commitId)} <- ${parents.join(',')}`
    })
    .sort()
}

// Runs the drop as the host does for `dropCommit` and `insertCommit` messages.
async function run(commits: readonly CommitView[], drop: PreviewDrop): Promise<void> {
  const repo = makeRepo(root)
  const changeOf = (id: string) => commits.find((c) => c.commitId === id)?.changeId ?? id
  const source = changeOf(drop.sourceId)
  const revset = drop.mode === 'source' ? `${source}::` : source
  if (drop.kind === 'onto') {
    await (drop.action === 'rebase'
      ? repo.rebase(source, changeOf(drop.targetId), drop.mode)
      : repo.duplicate(revset, changeOf(drop.targetId)))
    return
  }
  const after = changeOf(drop.afterId)
  const before = changeOf(drop.beforeId)
  await (drop.action === 'rebase'
    ? repo.rebaseBetween(source, drop.mode, after, before)
    : repo.duplicateBetween(revset, after, before))
}

function drop(
  kind: 'onto' | 'between',
  action: PreviewDrop['action'],
  mode: PreviewDrop['mode'],
  sourceId: string,
  first: string,
  second = '',
): PreviewDrop {
  return kind === 'onto'
    ? { kind, action, mode, sourceId, targetId: first }
    : { kind, action, mode, sourceId, afterId: first, beforeId: second }
}

type MakeDrop = (id: (name: string) => string) => PreviewDrop

const CASES: [string, MakeDrop][] = [
  ['rebase x and descendants onto t', (id) => drop('onto', 'rebase', 'source', id('x'), id('t'))],
  ['rebase y alone onto t', (id) => drop('onto', 'rebase', 'revision', id('y'), id('t'))],
  // Its children move down to b, and x stays on b without them.
  [
    'rebase x alone onto its own parent',
    (id) => drop('onto', 'rebase', 'revision', id('x'), id('b')),
  ],
  [
    'duplicate x and descendants onto t',
    (id) => drop('onto', 'duplicate', 'source', id('x'), id('t')),
  ],
  ['duplicate x alone onto t', (id) => drop('onto', 'duplicate', 'revision', id('x'), id('t'))],
  [
    'rebase x and descendants between t and u',
    (id) => drop('between', 'rebase', 'source', id('x'), id('t'), id('u')),
  ],
  [
    'rebase y alone between t and u',
    (id) => drop('between', 'rebase', 'revision', id('y'), id('t'), id('u')),
  ],
  [
    'duplicate x and descendants between t and u',
    (id) => drop('between', 'duplicate', 'source', id('x'), id('t'), id('u')),
  ],
  [
    'duplicate x alone between t and u',
    (id) => drop('between', 'duplicate', 'revision', id('x'), id('t'), id('u')),
  ],
]

async function expectPreviewMatchesJj(revset: string, make: MakeDrop): Promise<void> {
  buildGraph()
  const before = await graphOf(revset)
  const name = nameOf(before)
  const idOf = (wanted: string) => before.find((c) => name(c.commitId) === wanted)?.commitId ?? ''
  const dropped = make(idOf)
  const preview = previewDrop(before, dropped, { ghosts: false })
  if (!preview.ok) {
    throw new Error(`no preview: ${preview.error}`)
  }

  await run(before, dropped)
  const after = await graphOf(revset)

  // Copies take the name of the change they copy, and moved changes keep theirs.
  expect(shape(after, nameOf(after))).toEqual(shape(preview.nodes, name))
}

describe('drop preview against jj', () => {
  test.each(CASES)('%s', (_, make) => expectPreviewMatchesJj('all()', make))

  test('keeps elided edges when a hidden change sits between', () =>
    expectPreviewMatchesJj(`all() ~ ${exact('y')}`, (id) =>
      drop('onto', 'rebase', 'revision', id('x'), id('t')),
    ))
})
