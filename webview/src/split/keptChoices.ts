import type { SplitFile, SplitRequest } from '../../../shared/split'

export type FileChoice = ReadonlySet<number> | 'whole'

function sameFile(a: SplitFile, b: SplitFile): boolean {
  return (
    a.sourcePath === b.sourcePath &&
    a.status === b.status &&
    a.isBinary === b.isBinary &&
    JSON.stringify(a.segments) === JSON.stringify(b.segments)
  )
}

// The choices that still mean the same thing after the host sent the change again. Hunks are
// numbered per file, so a choice stays only while its file has the same hunks.
export function keptChoices(
  choices: ReadonlyMap<string, FileChoice>,
  previous: SplitRequest | null,
  next: SplitRequest,
): ReadonlyMap<string, FileChoice> {
  if (!previous || previous.commitId !== next.commitId) {
    return new Map()
  }
  const before = new Map(previous.files.map((file) => [file.path, file]))
  const kept = [...choices].filter(([path]) => {
    const old = before.get(path)
    const now = next.files.find((file) => file.path === path)
    return old !== undefined && now !== undefined && sameFile(old, now)
  })
  return kept.length === choices.size ? choices : new Map(kept)
}
