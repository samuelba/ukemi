import { isAbsolute } from 'node:path'

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

const REMOTE_URL = /^(https?|ssh|file):\/\/\S+$/i
const SCP_REMOTE = /^git@[^:\s]+:\S+$/

const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*:[^\s/@]*@/gi
const TOKEN_USERNAME = /^[a-z][a-z0-9+.-]*:\/\/(?:gh[pousr]_|github_pat_|glpat-)[^\s/@:]*@/i

export function redactUrlCredentials(text: string): string {
  return text.replace(URL_PASSWORD, '$1***@')
}

function embedsCredentials(value: string): boolean {
  return redactUrlCredentials(value) !== value || TOKEN_USERNAME.test(value)
}

export function validateRemoteUrl(url: string): string | null {
  const value = url.trim()
  if (embedsCredentials(value)) {
    return 'Do not put a password or token in the URL. Ukemi asks for credentials when needed.'
  }
  if (value.length === 0 || REMOTE_URL.test(value) || SCP_REMOTE.test(value) || isAbsolute(value)) {
    return null
  }
  return 'Enter a Git remote URL or an absolute path'
}

export function validateRemoteName(name: string): string | null {
  if (name.trim().length === 0) {
    return 'Enter a name'
  }
  if (/\s/.test(name) || name.includes('..')) {
    return 'Not a valid remote name'
  }
  return null
}
