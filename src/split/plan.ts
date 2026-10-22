import type { SplitFile, SplitSelection } from '../../shared/split'
import { buildContent } from './hunks'

export interface FileContents {
  left: Buffer | null
  right: Buffer | null
}

export interface PlanEntry {
  path: string
  content: string | null
}

const encode = (data: Buffer | null): string | null => (data ? data.toString('base64') : null)

export function buildPlan(
  files: readonly SplitFile[],
  contents: ReadonlyMap<string, FileContents>,
  selections: readonly SplitSelection[],
): PlanEntry[] {
  const byPath = new Map(selections.map((s) => [s.path, s]))
  return files.flatMap((file): PlanEntry[] => {
    const data = contents.get(file.path) ?? { left: null, right: null }
    const selection = byPath.get(file.path)
    const isSelected = selection?.isWholeFile ?? false
    const isMoved = file.sourcePath !== file.path

    if (isMoved) {
      return [
        { path: file.path, content: isSelected ? encode(data.right) : null },
        ...(file.status === 'renamed'
          ? [{ path: file.sourcePath, content: isSelected ? null : encode(data.left) }]
          : []),
      ]
    }
    if (file.isBinary || isSelected) {
      return [{ path: file.path, content: encode(isSelected ? data.right : data.left) }]
    }
    const hunks = new Set(selection?.hunks ?? [])
    if (hunks.size === 0) {
      return [{ path: file.path, content: encode(data.left) }]
    }
    const text = buildContent(file.segments, hunks)
    const isAbsent = text.length === 0 && (data.left === null || data.right === null)
    return [
      { path: file.path, content: isAbsent ? null : Buffer.from(text, 'utf8').toString('base64') },
    ]
  })
}
