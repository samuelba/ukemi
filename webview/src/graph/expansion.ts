import type { CommitView } from '../../../shared/protocol'

type ExpandableCommit = Pick<CommitView, 'changeId' | 'isWorkingCopy'>

// The working copy opens unless the user collapsed it, and that choice carries over to the next
// working copy. Other changes open only when the user opened them.
export interface Expansion {
  readonly expanded: ReadonlySet<string>
  readonly isWorkingCopyCollapsed: boolean
}

export function isExpanded(expansion: Expansion, commit: ExpandableCommit): boolean {
  return commit.isWorkingCopy
    ? !expansion.isWorkingCopyCollapsed
    : expansion.expanded.has(commit.changeId)
}

// Toggling the working copy also records the choice for its change, so the change keeps it once
// another change becomes the working copy.
export function toggleExpansion(expansion: Expansion, commit: ExpandableCommit): Expansion {
  const open = !isExpanded(expansion, commit)
  const expanded = new Set(expansion.expanded)
  if (open) {
    expanded.add(commit.changeId)
  } else {
    expanded.delete(commit.changeId)
  }
  return {
    expanded,
    isWorkingCopyCollapsed: commit.isWorkingCopy ? !open : expansion.isWorkingCopyCollapsed,
  }
}
