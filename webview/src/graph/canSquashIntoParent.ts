import type { Commit } from '../../../shared/model'

export function canSquashIntoParent(
  commit: Pick<Commit, 'isImmutable' | 'isWorkingCopy' | 'isEmpty' | 'parents'>,
  commitsById: ReadonlyMap<string, Pick<Commit, 'isImmutable'>>,
): boolean {
  if (
    commit.isImmutable ||
    commit.parents.length !== 1 ||
    (commit.isWorkingCopy && commit.isEmpty)
  ) {
    return false
  }
  const parent = commitsById.get(commit.parents[0] ?? '')
  return parent === undefined || !parent.isImmutable
}
