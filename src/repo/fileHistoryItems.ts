import { authorLabel, type BlameRun, type FileHistoryEntry } from '../../shared/fileHistory'
import { shortId, title } from '../../shared/format'
import type { AnnotatedLine, Commit } from '../../shared/model'

const SHORT_COMMIT_LENGTH = 8

export function fileHistoryEntry(
  repoId: string,
  path: string,
  commit: Commit,
  changeIdLength: number,
): FileHistoryEntry {
  return {
    kind: 'fileHistory',
    repoId,
    path,
    commitId: commit.commitId,
    changeId: commit.changeId,
    shortChangeId: shortId(commit.changeId, commit.changePrefix, changeIdLength),
    shortCommitId: shortId(commit.commitId, commit.commitPrefix, SHORT_COMMIT_LENGTH),
    summary: title(commit.description),
    author: commit.author.name || commit.author.email,
    isMine: commit.isMine,
    time: commit.author.timestamp,
    isWorkingCopy: commit.isWorkingCopy,
  }
}

// Neighbouring lines from the same change form one run, so a view can label each run once.
export function blameRuns(lines: readonly AnnotatedLine[]): BlameRun[] {
  const runs: BlameRun[] = []
  for (const line of lines) {
    const last = runs[runs.length - 1]
    if (last && last.commitId === line.commitId && last.start + last.count === line.line) {
      last.count += 1
    } else {
      runs.push({ start: line.line, count: 1, commitId: line.commitId })
    }
  }
  return runs
}

// The text a blame shows for a line's change: who, when, what, and the change and commit ids.
export function blameLabel(entry: FileHistoryEntry, when: string): string {
  if (entry.isWorkingCopy) {
    return `Working copy · not committed yet · ${entry.shortChangeId}`
  }
  const summary = entry.summary || '(no description)'
  const ids = `${entry.shortChangeId} ${entry.shortCommitId}`
  return [authorLabel(entry), when, summary, ids].filter((part) => part.length > 0).join(' · ')
}
