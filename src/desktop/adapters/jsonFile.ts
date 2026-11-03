import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { errorMessage } from '../../util/logger'

export interface JsonRead {
  values: Record<string, unknown>
  // Why a file that exists could not be used, or null.
  problem: string | null
}

export type ProblemListener = (problem: string) => void

// A missing file reads as an empty object. A file that does not parse also reads as one, so it
// never blocks startup, but with a problem, so callers can keep what they have and say so.
export function readJson(path: string): JsonRead {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return { values: {}, problem: null }
  }
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? { values: value as Record<string, unknown>, problem: null }
      : { values: {}, problem: `${path} does not hold a JSON object` }
  } catch (error) {
    return { values: {}, problem: `${path} is not valid JSON: ${errorMessage(error)}` }
  }
}

export function readJsonObject(path: string): Record<string, unknown> {
  return readJson(path).values
}

// Writes through a temporary file, so a crash leaves the old file and not half of a new one. A file
// that does not parse is likely a hand edit gone wrong, so it is kept next to the new one.
export function writeJsonObject(path: string, value: Record<string, unknown>, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true })
  if (readJson(path).problem !== null) {
    copyFileSync(path, invalidCopyPath(path))
  }
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode })
  renameSync(temporary, path)
}

export function invalidCopyPath(path: string): string {
  return `${path}.invalid`
}

export function withoutKey(values: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([name]) => name !== key))
}
