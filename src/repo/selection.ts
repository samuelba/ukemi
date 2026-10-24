export interface SelectedChange {
  repoId: string
  commitId: string
  changeId: string
}

export function resolveSelectedCommit<T extends { commitId: string; changeId: string }>(
  commits: readonly T[],
  selected: SelectedChange | null,
  repoId: string,
): T | null {
  if (!selected || selected.repoId !== repoId) {
    return null
  }
  const unique = uniqueCommits(commits)
  const byCommit = unique.find((commit) => commit.commitId === selected.commitId)
  if (byCommit) {
    return byCommit
  }
  const sameChange = unique.filter((commit) => commit.changeId === selected.changeId)
  return sameChange.length === 1 ? (sameChange[0] ?? null) : null
}

function uniqueCommits<T extends { commitId: string }>(commits: readonly T[]): T[] {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const commit of commits) {
    if (seen.has(commit.commitId)) {
      continue
    }
    seen.add(commit.commitId)
    unique.push(commit)
  }
  return unique
}
