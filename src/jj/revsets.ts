import type { GraphFilter, HistoryDepth } from '../../shared/model'
import { jjString } from './templates'

export function quoteRevsetString(text: string): string {
  return jjString(text)
}

// jj reads `ok|main`, `rel-` or `a,b` as expressions, not as names. Git allows such branch names,
// so a fetch can bring them in. Plain names stay bare, so pickers and labels look as jj shows them.
const PLAIN_SYMBOL = /^[\p{L}\p{N}_/]+(?:[.+-][\p{L}\p{N}_/]+)*$/u

export function revsetSymbol(name: string): string {
  return PLAIN_SYMBOL.test(name) ? name : jjString(name)
}

export function bookmarkRevision(name: string, remote?: string | null): string {
  return remote ? `${revsetSymbol(name)}@${revsetSymbol(remote)}` : revsetSymbol(name)
}

export function exactBookmark(name: string): string {
  return `exact:${jjString(name)}`
}

export interface ChangeRef {
  commitId: string
  changeId: string
  isDivergent: boolean
  isHidden: boolean
}

// jj snapshots the working copy before each command, which gives it a new commit id. A commit id
// from the last refresh can then name the hidden predecessor, and rewriting that one makes the
// change divergent. The change id follows the snapshot. Only a divergent or hidden commit needs
// its commit id, since its change id names other commits too.
export function changeRevision(commit: ChangeRef): string {
  return commit.isDivergent || commit.isHidden ? commit.commitId : commit.changeId
}

export function rootFileset(path: string): string {
  return `root-file:${quoteRevsetString(path)}`
}

const DEPTH_EXPRESSIONS: Record<HistoryDepth, string | null> = {
  '7d': '7 days ago',
  '14d': '14 days ago',
  '30d': '30 days ago',
  '1y': '1 year ago',
  all: null,
}

function dateFilter(depth: HistoryDepth): string {
  const after = DEPTH_EXPRESSIONS[depth]
  return after === null ? 'all()' : `committer_date(after:${quoteRevsetString(after)})`
}

export const CURRENT_BOOKMARKS_REVSET = 'heads(::@ & bookmarks() & mutable())'

const ANCHORS = 'present(@) | working_copies() | present(trunk())'
const TRUNK_HISTORY_LENGTH = 10
const TRUNK_HISTORY = `first_ancestors(present(trunk()), ${TRUNK_HISTORY_LENGTH})`
const WORKING_COPY_CHAIN = 'first_ancestors(@, 6)'
const WORKING_COPY_REVSET = `((${WORKING_COPY_CHAIN} & mutable()) | heads(${WORKING_COPY_CHAIN} & immutable())) ~ root()`

export function graphRevset(filter: GraphFilter, depth: HistoryDepth): string {
  if (filter === 'working') {
    return WORKING_COPY_REVSET
  }
  const base = graphBase(filter, depth)
  return `(${ANCHORS} | (${base}) | (roots((${base}) & mutable())-)) ~ root()`
}

function graphBase(filter: Exclude<GraphFilter, 'working'>, depth: HistoryDepth): string {
  switch (filter) {
    case 'recent':
      return `((mutable() | bookmarks() | remote_bookmarks() | tags()) & ${dateFilter(depth)}) | ${TRUNK_HISTORY}`
    case 'mine':
      return 'mine() & mutable()'
    case 'myHistory':
      return `mine() & (mutable() | ${dateFilter(depth)})`
    case 'stack':
      return 'reachable(@, mutable())'
  }
}
