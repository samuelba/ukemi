export interface SearchableCommit {
  commitId: string
  changeId: string
  description: string
  author: { name: string; email: string }
  localBookmarks: ReadonlyArray<{ name: string }>
  tags: readonly string[]
}

export interface SearchQuery {
  // Every term must match. `author:` terms look at the author only.
  terms: string[]
  authors: string[]
}

export function parseSearch(text: string): SearchQuery | null {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0)
  if (words.length === 0) {
    return null
  }
  const terms: string[] = []
  const authors: string[] = []
  for (const word of words) {
    if (word.startsWith('author:')) {
      const name = word.slice('author:'.length)
      if (name !== '') {
        authors.push(name)
      }
    } else {
      terms.push(word)
    }
  }
  return terms.length === 0 && authors.length === 0 ? null : { terms, authors }
}

export function matchesCommit(commit: SearchableCommit, query: SearchQuery): boolean {
  const author = `${commit.author.name} ${commit.author.email}`.toLowerCase()
  if (!query.authors.every((name) => author.includes(name))) {
    return false
  }
  if (query.terms.length === 0) {
    return true
  }
  const text = [
    commit.description,
    author,
    ...commit.localBookmarks.map((bookmark) => bookmark.name),
    ...commit.tags,
  ]
    .join('\n')
    .toLowerCase()
  return query.terms.every(
    (term) =>
      text.includes(term) || commit.changeId.startsWith(term) || commit.commitId.startsWith(term),
  )
}

// The ids of the matching commits in graph order, or null when there is no search.
export function searchCommits(commits: readonly SearchableCommit[], text: string): string[] | null {
  const query = parseSearch(text)
  return query
    ? commits.filter((commit) => matchesCommit(commit, query)).map((commit) => commit.commitId)
    : null
}

// The match after (or before) the selected one, wrapping around.
export function stepMatch(
  matches: readonly string[],
  selected: string | null,
  direction: 1 | -1,
): string | null {
  if (matches.length === 0) {
    return null
  }
  const index = selected === null ? -1 : matches.indexOf(selected)
  if (index < 0) {
    return direction === 1 ? (matches[0] ?? null) : (matches[matches.length - 1] ?? null)
  }
  return matches[(index + direction + matches.length) % matches.length] ?? null
}
