import type { Commit, GraphFilter, HistoryDepth, Operation } from '../../shared/model'
import type { GraphState } from '../../shared/protocol'
import { GRAPH_PAGE_SIZE } from '../jj/repo'
import { commitSetRevset } from '../jj/revsets'

// The revsets a graph refresh reads with, besides the graph's own: what the elision lookups
// search, and how a refresh after snapshots finds the page without evaluating the revset.

export interface GraphView {
  readonly filter: GraphFilter
  readonly depth: HistoryDepth
  readonly revset: string | null
}

const SNAPSHOT_OPERATION = 'snapshot working copy'

// The newest change of each stack that is not based on the current trunk, so a rebase onto the
// trunk would move it. Without a trunk bookmark trunk() is root(), and the set is empty.
export const STALE_STACK_HEADS_REVSET = 'heads(mutable()) ~ trunk()::'

// A revset of ids makes jj read only the commits it names, so a list stays well under the 32 KB
// command line of Windows up to this many commits.
const MAX_LISTED_COMMITS = GRAPH_PAGE_SIZE

// True when the newest operations are snapshots that lead straight back to `since`. The log
// lists each operation before its parents, and a snapshot has one parent, so `since` coming
// right after the snapshots means it is their ancestor and nothing else landed in between.
export function onlySnapshotsSince(
  operations: readonly Operation[],
  since: string | null,
): boolean {
  if (since === null) {
    return false
  }
  const index = operations.findIndex((operation) => operation.id === since)
  if (index <= 0) {
    return false
  }
  return operations
    .slice(0, index)
    .every((operation) => operation.description.trim() === SNAPSHOT_OPERATION)
}

// A snapshot rewrites the working copy and rebases its descendants, so every other commit, and
// with it the ancestry of each unchanged elided parent, stays as it was. The rewritten commits
// are mutable and keep their author, so they stay in or out of the preset revsets, except under
// a date window, which a rewrite can move an old commit into. A typed revset can match
// anything, so it gets no shortcut.
export function snapshotsKeepMembership(view: GraphView): boolean {
  // A typed revset, like the user's jj log revset, can hold a date window or anything else.
  if (view.revset !== null || view.filter === 'jjLog') {
    return false
  }
  return view.filter !== 'recent' || view.depth === 'all'
}

export interface LookupTarget {
  readonly revset: string
  // True when `revset` lists the shown commits rather than being the graph's revset.
  readonly listsShown: boolean
}

// What the elision lookups search. A graph that is not truncated shows all of the revset, so
// `heads(::P & <shown ids>)` gives the same commits in the same order as `heads(::P & <revset>)`.
// jj then checks only the shown commits, where the revset can make it read every commit in the
// repository, as `mine()` and date filters do.
export function lookupTarget(
  revset: string,
  commits: readonly Commit[],
  isTruncated: boolean,
): LookupTarget {
  if (isTruncated || commits.length > MAX_LISTED_COMMITS) {
    return { revset, listsShown: false }
  }
  return { revset: commitSetRevset(commits.map((commit) => commit.commitId)), listsShown: true }
}

export interface SnapshotPageInput {
  readonly view: GraphView
  // The graph on screen, and the operation the last load read it at.
  readonly shown: GraphState | null
  readonly shownOperation: string | null
  // The newest operations, newest first, as of the coming load.
  readonly operations: readonly Operation[]
}

// After snapshots only, the page is the shown commits, with the working copies rewritten and
// their descendants rebased, so it can be read from those commits instead of from `revset`.
// Their change ids find the rewritten commits, and `& (revset)` drops what left the revset, such
// as commits a date window has slid past. Under snapshotsKeepMembership no commit can join the
// revset, so the shown ones are all there is; `working_copies()::` only guards that, as the
// commits a snapshot rewrites. jj still sorts and renders every row, so the page is the one the
// revset gives, at a fraction of the cost when the revset makes jj read every commit.
//
// Null when that does not hold or cannot be checked: another operation, a view or page that
// differs from the shown one, a truncated graph, whose end could move, or a divergent change,
// whose change id names more commits than the graph shows.
export function snapshotPageRevset(input: SnapshotPageInput, revset: string): string | null {
  const { view, shown } = input
  if (
    shown === null ||
    !snapshotsKeepMembership(view) ||
    !onlySnapshotsSince(input.operations, input.shownOperation)
  ) {
    return null
  }
  if (
    !isSameGraph(shown, input) ||
    shown.isTruncated ||
    shown.commits.length > MAX_LISTED_COMMITS ||
    shown.commits.some((commit) => commit.isDivergent)
  ) {
    return null
  }
  // A hidden commit stays hidden, and its change id would name the visible commit instead.
  const named = shown.commits.map((commit) =>
    commit.isHidden ? commit.commitId : `change_id(${commit.changeId})`,
  )
  return `(${[...named, 'working_copies()::'].join(' | ')}) & (${revset})`
}

// True when the page loaded after snapshots only differs from the shown one by rewritten
// commits: each commit that left has a change that came back under a new commit id. The
// lookups of both pages search the shown commits (see lookupTarget). A commit the snapshots
// created is no ancestor of an older one, and one they hid is no ancestor of a visible one, so
// the lookup of every unchanged parent keeps its answer. That holds for any revset, a date
// window or a typed one too, as long as nothing else joined or left the page.
export function pageChangedOnlyByRewrites(
  input: SnapshotPageInput,
  commits: readonly Commit[],
  isTruncated: boolean,
): boolean {
  const { shown } = input
  if (
    shown === null ||
    !onlySnapshotsSince(input.operations, input.shownOperation) ||
    !isSameGraph(shown, input)
  ) {
    return false
  }
  const listed = (page: readonly Commit[]): boolean => page.length <= MAX_LISTED_COMMITS
  if (shown.isTruncated || isTruncated || !listed(shown.commits) || !listed(commits)) {
    return false
  }
  if ([...shown.commits, ...commits].some((commit) => commit.isDivergent)) {
    return false
  }
  const before = new Set(shown.commits.map((commit) => commit.commitId))
  const after = new Set(commits.map((commit) => commit.commitId))
  const left = shown.commits.filter((commit) => !after.has(commit.commitId))
  const joined = commits.filter((commit) => !before.has(commit.commitId))
  const leftChanges = new Set(left.map((commit) => commit.changeId))
  return (
    left.length === joined.length &&
    leftChanges.size === left.length &&
    joined.every((commit) => leftChanges.has(commit.changeId))
  )
}

// The shown graph is the one of the last load, and of the view the coming load reads.
function isSameGraph(shown: GraphState, input: SnapshotPageInput): boolean {
  return (
    shown.operationId === input.shownOperation &&
    shown.filter === input.view.filter &&
    shown.depth === input.view.depth &&
    shown.revset === input.view.revset
  )
}
