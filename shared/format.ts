const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function relativeTime(iso: string, now: number): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) {
    return ''
  }
  const delta = Math.max(0, now - time)
  if (delta < MINUTE) {
    return 'now'
  }
  if (delta < HOUR) {
    return `${Math.floor(delta / MINUTE)}m`
  }
  if (delta < DAY) {
    return `${Math.floor(delta / HOUR)}h`
  }
  if (delta < 30 * DAY) {
    return `${Math.floor(delta / DAY)}d`
  }
  const date = new Date(time)
  const month = MONTHS[date.getMonth()] ?? ''
  return new Date(now).getFullYear() === date.getFullYear()
    ? `${month} ${date.getDate()}`
    : `${month} ${date.getFullYear()}`
}

export interface IdParts {
  prefix: string
  rest: string
}

export function splitId(id: string, uniquePrefix: string, minLength: number): IdParts {
  const length = Math.max(minLength, uniquePrefix.length)
  return { prefix: id.slice(0, uniquePrefix.length), rest: id.slice(uniquePrefix.length, length) }
}

export function shortId(id: string, uniquePrefix: string, minLength: number): string {
  const parts = splitId(id, uniquePrefix, minLength)
  return `${parts.prefix}${parts.rest}`
}

export interface PathParts {
  name: string
  dir: string
}

export function splitPath(path: string): PathParts {
  const index = path.lastIndexOf('/')
  return index < 0
    ? { name: path, dir: '' }
    : { name: path.slice(index + 1), dir: path.slice(0, index) }
}

export function title(description: string): string {
  return description.split('\n')[0]?.trim() ?? ''
}
