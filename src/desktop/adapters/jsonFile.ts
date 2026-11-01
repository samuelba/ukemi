import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// A missing or unreadable file reads as an empty object, so a broken file never blocks startup.
export function readJsonObject(path: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

// Writes through a temporary file, so a crash leaves the old file and not half of a new one.
export function writeJsonObject(path: string, value: Record<string, unknown>, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode })
  renameSync(temporary, path)
}

export function withoutKey(values: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([name]) => name !== key))
}
