import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Logger } from '../util/logger'

const MAX_LOG_BYTES = 5_000_000

// Appends to a log file the user can open from Help > Show Log. One old file is kept.
export function fileLogger(path: string, echo: boolean): Logger {
  mkdirSync(dirname(path), { recursive: true })
  try {
    if (statSync(path).size > MAX_LOG_BYTES) {
      renameSync(path, `${path}.old`)
    }
  } catch {
    // No log yet.
  }
  const write = (level: string, message: string) => {
    const line = `${new Date().toISOString()} [${level}] ${message}\n`
    try {
      appendFileSync(path, line)
    } catch {
      // Logging must never break the app.
    }
    if (echo) {
      process.stderr.write(line)
    }
  }
  return {
    info: (message) => write('info', message),
    warn: (message) => write('warning', message),
    error: (message) => write('error', message),
  }
}
