export interface Selection {
  commitId: string
  changeId: string
}

interface Row {
  commitId: string
  changeId: string
  isWorkingCopy: boolean
}

// The row to show as selected. A snapshot or rewrite gives the change a new commit, so the
// selection follows the change. With nothing selected yet, that is the working copy.
export function selectedRow(commits: readonly Row[], selection: Selection | null): string | null {
  if (!selection) {
    return commits.find((commit) => commit.isWorkingCopy)?.commitId ?? null
  }
  if (commits.some((commit) => commit.commitId === selection.commitId)) {
    return selection.commitId
  }
  return commits.find((commit) => commit.changeId === selection.changeId)?.commitId ?? null
}
