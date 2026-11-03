import type { FileBlame, FileHistoryEntry } from '../../shared/fileHistory'
import { blameRuns, fileHistoryEntry } from '../repo/fileHistoryItems'
import type { RepoModel } from '../repo/repoModel'
import { revisionText } from './revisionContent'

export async function loadFileHistory(
  model: RepoModel,
  path: string,
  changeIdLength: number,
): Promise<FileHistoryEntry[]> {
  const commits = await model.repo.fileHistory(path)
  return commits.map((commit) => fileHistoryEntry(model.root, path, commit, changeIdLength))
}

// Who last changed each line of the file at the revision, with the file's text there.
export async function loadBlame(
  model: RepoModel,
  path: string,
  commitId: string,
  changeIdLength: number,
): Promise<FileBlame> {
  const [lines, text] = await Promise.all([
    model.repo.annotate(commitId, path),
    revisionText(model, commitId, path),
  ])
  const ids = [...new Set(lines.map((line) => line.commitId))]
  const commits = ids.length > 0 ? await model.repo.log(ids.join(' | '), ids.length) : []
  const changes: Record<string, FileHistoryEntry> = {}
  for (const commit of commits) {
    changes[commit.commitId] = fileHistoryEntry(model.root, path, commit, changeIdLength)
  }
  return { commitId, text, runs: blameRuns(lines), changes }
}
