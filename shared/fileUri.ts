import type { ChangedFile } from './model'

export interface FileDragPayload {
  commitId: string
  path: string
  isImmutable: boolean
}

export interface FileDragTransfer {
  payload: string
  uriList: string | undefined
  resourceUrls: string | undefined
  locked: boolean
}

const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/

export function fileUri(root: string, path: string): string {
  const absolute = joinRoot(root, path)
  if (absolute.startsWith('\\\\')) {
    return uncUri(absolute)
  }
  const posix = absolute.replaceAll('\\', '/')
  const url = new URL('file://')
  url.pathname = posix.startsWith('/') ? posix : `/${posix}`
  return url.href
}

export function fileDragTransfer(
  root: string,
  commit: { commitId: string; isImmutable: boolean },
  file: { path: string; status: ChangedFile['status'] },
): FileDragTransfer {
  const uri = file.status === 'removed' ? undefined : fileUri(root, file.path)
  return {
    payload: JSON.stringify({
      commitId: commit.commitId,
      path: file.path,
      isImmutable: commit.isImmutable,
    }),
    uriList: uri,
    resourceUrls: uri && JSON.stringify([uri]),
    locked: commit.isImmutable,
  }
}

export function parseFileDrag(raw: string): FileDragPayload | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) {
    return null
  }
  const record = data as Record<string, unknown>
  if (typeof record.commitId !== 'string' || typeof record.path !== 'string') {
    return null
  }
  return {
    commitId: record.commitId,
    path: record.path,
    isImmutable: record.isImmutable === true,
  }
}

function joinRoot(root: string, path: string): string {
  const windows = WINDOWS_DRIVE.test(root) || root.startsWith('\\\\')
  const sep = windows ? '\\' : '/'
  const relative = windows ? path.replaceAll('/', '\\') : path.replaceAll('\\', '/')
  const base = root.endsWith('/') || root.endsWith('\\') ? root.slice(0, -1) : root
  return relative.length === 0 ? base : `${base}${sep}${relative}`
}

function uncUri(absolute: string): string {
  const parts = absolute.slice(2).split('\\')
  const server = parts[0]
  const share = parts[1]
  if (!server || !share) {
    const url = new URL('file://')
    url.pathname = `/${absolute.replaceAll('\\', '/')}`
    return url.href
  }
  const rest = parts.slice(2).join('/')
  const url = new URL(`file://${server}/${share}`)
  url.pathname = rest.length === 0 ? `/${share}` : `/${share}/${rest}`
  return url.href
}
