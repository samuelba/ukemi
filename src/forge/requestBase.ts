import { quoteRevsetString } from '../jj/revsets'

export interface BookmarkedRevision {
  localBookmarks: readonly { name: string }[]
}

export function parentBookmarks(
  ancestors: readonly BookmarkedRevision[],
  trunk: string,
  head: string,
): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const ancestor of ancestors) {
    for (const bookmark of ancestor.localBookmarks) {
      if (bookmark.name === trunk || bookmark.name === head || seen.has(bookmark.name)) {
        continue
      }
      seen.add(bookmark.name)
      names.push(bookmark.name)
    }
  }
  return names
}

export function parentBookmarkRevset(commitId: string): string {
  return `heads((::${quoteRevsetString(commitId)}- ~ ::trunk()) & bookmarks())`
}

export function stackDetail(branch: string, requestNumber: number | undefined): string {
  if (requestNumber === undefined) {
    return `Stacked on ${branch}`
  }
  return `Stacked on ${branch} (#${requestNumber})`
}

export function shouldPushBase(
  base: string,
  head: string,
  localNames: readonly string[],
  pushedNames: ReadonlySet<string>,
): boolean {
  return base !== head && localNames.includes(base) && !pushedNames.has(base)
}
