const MAX_BOOKMARK_SLUG = 40

export function firstLine(description: string): string {
  return description.split('\n')[0]?.trim() ?? ''
}

export function bodyAfterTitle(description: string): string {
  return description.split('\n').slice(1).join('\n').trim()
}

export function combineDescriptions(parent: string, child: string): string {
  return [parent.trim(), child.trim()].filter((part) => part.length > 0).join('\n\n')
}

export function bookmarkSlug(description: string, changeId: string): string {
  const slug = firstLine(description)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BOOKMARK_SLUG)
    .replace(/-+$/, '')
  return slug || `ukemi/${changeId.slice(0, 8)}`
}

const INVALID_BOOKMARK = /(^[-./])|(\.\.)|([\s~^:?*[\\])|(@\{)|(\.lock$)|([./]$)/

export function validateBookmarkName(name: string): string | null {
  if (name.trim().length === 0) {
    return 'Enter a name'
  }
  if (INVALID_BOOKMARK.test(name)) {
    return 'Not a valid Git branch name'
  }
  return null
}
