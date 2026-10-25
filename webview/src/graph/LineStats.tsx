import type { ChangedFile } from '../../../shared/model'

interface LineStatsProps {
  added: number
  removed: number
}

export function lineTotals(
  files: readonly ChangedFile[],
): { added: number; removed: number } | null {
  let added = 0
  let removed = 0
  let counted = false
  for (const file of files) {
    if (file.linesAdded === undefined && file.linesRemoved === undefined) {
      continue
    }
    added += file.linesAdded ?? 0
    removed += file.linesRemoved ?? 0
    counted = true
  }
  if (!counted || (added === 0 && removed === 0)) {
    return null
  }
  return { added, removed }
}

export function LineStats({ added, removed }: LineStatsProps) {
  if (added <= 0 && removed <= 0) {
    return null
  }
  return (
    <span className="line-stats">
      {added > 0 && <span className="line-added">+{added}</span>}
      {removed > 0 && <span className="line-removed">-{removed}</span>}
    </span>
  )
}
