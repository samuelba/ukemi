import type { LogLine } from '../../shared/desktopProtocol'
import { Emitter } from '../app/events'
import type { Logger } from '../util/logger'

const KEPT_LINES = 2_000

// Writes through to the log file and keeps the recent lines for the log panel.
export class LogBuffer implements Logger {
  private lines: LogLine[] = []
  private readonly emitter = new Emitter<LogLine>()
  readonly onLine = this.emitter.event

  constructor(
    private readonly target: Logger,
    private readonly limit = KEPT_LINES,
  ) {}

  info(message: string): void {
    this.target.info(message)
    this.add('info', message)
  }

  warn(message: string): void {
    this.target.warn(message)
    this.add('warning', message)
  }

  error(message: string): void {
    this.target.error(message)
    this.add('error', message)
  }

  recent(): LogLine[] {
    return [...this.lines]
  }

  clear(): void {
    this.lines = []
  }

  private add(level: LogLine['level'], message: string): void {
    const line: LogLine = { time: new Date().toISOString(), level, message }
    this.lines =
      this.lines.length >= this.limit
        ? [...this.lines.slice(1 - this.limit), line]
        : [...this.lines, line]
    this.emitter.fire(line)
  }
}
