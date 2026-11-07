import type { ChangedFile, FileStatus } from '../../../shared/model'

interface RowFlags {
  isWorkingCopy: boolean
  hasConflict: boolean
  isImmutable: boolean
  isDivergent: boolean
  isHidden: boolean
  isEmpty: boolean
  isMine: boolean
}

// The states the node shape in GraphCell shows, spelled out for screen readers.
export function statusWords(commit: RowFlags): string[] {
  const flags: [boolean, string][] = [
    [commit.isWorkingCopy, 'working copy'],
    [commit.hasConflict, 'conflict'],
    [commit.isImmutable, 'immutable'],
    [commit.isDivergent, 'divergent'],
    [commit.isHidden, 'hidden'],
    [commit.isEmpty, 'empty'],
    [!commit.isMine, "someone else's"],
  ]
  return flags.filter(([isSet]) => isSet).map(([, word]) => word)
}

const FILE_STATUS_WORD: Readonly<Record<FileStatus, string>> = {
  added: 'added',
  modified: 'modified',
  removed: 'removed',
  renamed: 'renamed',
  copied: 'copied',
}

// The accessible name of a file row: its path and what happened to it.
export function fileLabel(file: Pick<ChangedFile, 'path' | 'status' | 'isConflicted'>): string {
  return `${file.path}, ${file.isConflicted ? 'conflicted' : FILE_STATUS_WORD[file.status]}`
}
