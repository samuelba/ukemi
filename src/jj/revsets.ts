import type { GraphFilter, HistoryDepth } from '../../shared/model'
import { jjString } from './templates'

export function quoteRevsetString(text: string): string {
  return jjString(text)
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

export function graphRevset(filter: GraphFilter, depth: HistoryDepth): string {
  const base = graphBase(filter, depth)
  return `(${ANCHORS} | (${base}) | (roots((${base}) & mutable())-)) ~ root()`
}

function graphBase(filter: GraphFilter, depth: HistoryDepth): string {
  switch (filter) {
    case 'recent':
      return `(mutable() | bookmarks() | remote_bookmarks() | tags()) & ${dateFilter(depth)}`
    case 'mine':
      return 'mine() & mutable()'
    case 'myHistory':
      return `mine() & (mutable() | ${dateFilter(depth)})`
    case 'stack':
      return 'reachable(@, mutable())'
  }
}
