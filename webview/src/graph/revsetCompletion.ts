import { jjString, revsetSymbol } from '../../../shared/revsetText'

export interface RevsetCandidate {
  label: string
  insert: string
  detail: string
}

export interface CompletionSources {
  bookmarks: readonly string[]
  tags: readonly string[]
  authors: ReadonlyArray<{ name: string; email: string }>
  history: readonly string[]
}

export interface Completion {
  text: string
  cursor: number
}

// Functions that take arguments are inserted with an open parenthesis, so typing goes on inside.
const FUNCTIONS: ReadonlyArray<{ name: string; args: boolean; detail: string }> = [
  { name: 'all', args: false, detail: 'every visible change' },
  { name: 'mine', args: false, detail: 'changes you authored' },
  { name: 'trunk', args: false, detail: 'the main bookmark of the default remote' },
  { name: 'mutable', args: false, detail: 'changes that can be rewritten' },
  { name: 'immutable', args: false, detail: 'changes that cannot be rewritten' },
  { name: 'bookmarks', args: false, detail: 'changes with a local bookmark' },
  { name: 'remote_bookmarks', args: false, detail: 'changes with a remote bookmark' },
  { name: 'tags', args: false, detail: 'changes with a tag' },
  { name: 'working_copies', args: false, detail: 'the working copies of all workspaces' },
  { name: 'conflicts', args: false, detail: 'changes with conflicts' },
  { name: 'empty', args: false, detail: 'changes that change no files' },
  { name: 'merges', args: false, detail: 'changes with more than one parent' },
  { name: 'visible_heads', args: false, detail: 'the heads of all visible changes' },
  { name: 'author', args: true, detail: 'author name or email matches' },
  { name: 'committer', args: true, detail: 'committer name or email matches' },
  { name: 'description', args: true, detail: 'the description matches' },
  { name: 'author_date', args: true, detail: 'authored in a date range, e.g. after:"1 week ago"' },
  { name: 'committer_date', args: true, detail: 'committed in a date range' },
  { name: 'files', args: true, detail: 'changes touching the paths' },
  { name: 'diff_contains', args: true, detail: 'the diff contains the text' },
  { name: 'ancestors', args: true, detail: 'the revisions and their ancestors' },
  { name: 'descendants', args: true, detail: 'the revisions and their descendants' },
  { name: 'parents', args: true, detail: 'the parents of the revisions' },
  { name: 'children', args: true, detail: 'the children of the revisions' },
  { name: 'heads', args: true, detail: 'the revisions no other one descends from' },
  { name: 'roots', args: true, detail: 'the revisions that descend from no other one' },
  { name: 'connected', args: true, detail: 'the revisions and everything between them' },
  { name: 'reachable', args: true, detail: 'reachable from the revisions within a domain' },
  { name: 'latest', args: true, detail: 'the newest revisions, by committer date' },
  { name: 'present', args: true, detail: 'the revisions, or none when they do not exist' },
  { name: 'fork_point', args: true, detail: 'the common ancestor of the revisions' },
]

const MAX_CANDIDATES = 12
const WORD = /[\p{L}\p{N}_./@-]/u

// The word that ends at the cursor, which a candidate replaces.
export function wordAt(text: string, cursor: number): { start: number; word: string } {
  let start = cursor
  while (start > 0 && WORD.test(text.charAt(start - 1))) {
    start -= 1
  }
  return { start, word: text.slice(start, cursor) }
}

export function revsetCompletions(
  text: string,
  cursor: number,
  sources: CompletionSources,
): RevsetCandidate[] {
  if (text.trim() === '') {
    return sources.history.map((revset) => ({ label: revset, insert: revset, detail: 'recent' }))
  }
  const needle = wordAt(text, cursor).word.toLowerCase()
  if (needle === '') {
    return []
  }
  const matches = (value: string) => value.toLowerCase().includes(needle)
  const functions = FUNCTIONS.filter((f) => f.name.startsWith(needle)).map((f) => ({
    label: `${f.name}()`,
    insert: f.args ? `${f.name}(` : `${f.name}()`,
    detail: f.detail,
  }))
  const bookmarks = sources.bookmarks.filter(matches).map((name) => ({
    label: name,
    insert: revsetSymbol(name),
    detail: 'bookmark',
  }))
  const tags = sources.tags.filter(matches).map((name) => ({
    label: name,
    insert: revsetSymbol(name),
    detail: 'tag',
  }))
  const authors = sources.authors
    .filter((author) => matches(author.name) || matches(author.email))
    .map((author) => ({
      label: `author(${author.email})`,
      insert: `author(${jjString(author.email)})`,
      detail: author.name,
    }))
  return [...functions, ...bookmarks, ...tags, ...authors].slice(0, MAX_CANDIDATES)
}

// Puts the candidate in place of the word at the cursor. An empty input takes it whole.
export function applyCompletion(
  text: string,
  cursor: number,
  candidate: RevsetCandidate,
): Completion {
  if (text.trim() === '') {
    return { text: candidate.insert, cursor: candidate.insert.length }
  }
  const { start } = wordAt(text, cursor)
  const next = text.slice(0, start) + candidate.insert + text.slice(cursor)
  return { text: next, cursor: start + candidate.insert.length }
}

// The bookmarks, tags and authors of the loaded changes, without repeats.
export function sourcesFromCommits(
  commits: ReadonlyArray<{
    localBookmarks: ReadonlyArray<{ name: string }>
    tags: readonly string[]
    author: { name: string; email: string }
  }>,
  history: readonly string[],
): CompletionSources {
  const bookmarks = new Set<string>()
  const tags = new Set<string>()
  const authors = new Map<string, { name: string; email: string }>()
  for (const commit of commits) {
    commit.localBookmarks.forEach((bookmark) => bookmarks.add(bookmark.name))
    commit.tags.forEach((tag) => tags.add(tag))
    if (commit.author.email !== '' && !authors.has(commit.author.email)) {
      authors.set(commit.author.email, commit.author)
    }
  }
  return {
    bookmarks: [...bookmarks].sort(),
    tags: [...tags].sort(),
    authors: [...authors.values()],
    history,
  }
}
