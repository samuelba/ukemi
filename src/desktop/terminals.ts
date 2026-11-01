import { homedir } from 'node:os'
import { basename } from 'node:path'
import type { IPty } from 'node-pty'
import type { DesktopHostMessage } from '../../shared/desktopProtocol'
import type { Disposable } from '../app/events'
import { errorMessage, type Logger } from '../util/logger'
import { terminalCommand } from './terminalCommand'

type Pty = typeof import('node-pty')

const FLUSH_MS = 8
const MAX_COLUMNS = 1_000
const MAX_ROWS = 500

interface Terminal {
  cwd: string
  // The name before numbering, to count terminals of the same folder.
  title: string
  pty: IPty | null
  pending: string
  timer: ReturnType<typeof setTimeout> | null
}

function size(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max
    ? value
    : null
}

// The terminals of one window. The view opens a tab, then starts the shell once it knows its size.
export class Terminals implements Disposable {
  private readonly terminals = new Map<string, Terminal>()
  private nextId = 1
  private pty: Pty | null = null

  constructor(
    private readonly post: (message: DesktopHostMessage) => void,
    private readonly logger: Logger,
  ) {}

  // Opens a terminal tab in a folder. The shell starts when the view sends its size.
  open(cwd: string = homedir(), name?: string): void {
    const id = `terminal-${this.nextId++}`
    const base = name ?? basename(cwd)
    const same = [...this.terminals.values()].filter((t) => t.title === base).length
    this.terminals.set(id, { cwd, title: base, pty: null, pending: '', timer: null })
    const title = same > 0 ? `${base} (${same + 1})` : base
    this.post({ type: 'desktop.terminalOpen', id, title, cwd })
  }

  async start(id: string, cols: unknown, rows: unknown): Promise<void> {
    const terminal = this.terminals.get(id)
    const columns = size(cols, MAX_COLUMNS)
    const lines = size(rows, MAX_ROWS)
    if (!terminal || terminal.pty || !columns || !lines) {
      return
    }
    try {
      const pty = await this.loadPty()
      const command = terminalCommand(process.platform, process.env, terminal.cwd)
      const child = pty.spawn(command.file, command.args, {
        name: 'xterm-256color',
        cols: columns,
        rows: lines,
        cwd: command.cwd,
        env: command.env,
      })
      terminal.pty = child
      child.onData((data) => this.queue(id, data))
      child.onExit(({ exitCode }) => {
        this.flush(id)
        terminal.pty = null
        this.post({ type: 'desktop.terminalExit', id, code: exitCode })
      })
    } catch (error: unknown) {
      this.logger.error(`the terminal failed to start: ${errorMessage(error)}`)
      this.post({
        type: 'desktop.terminalData',
        id,
        data: `\r\nUkemi could not start a terminal: ${errorMessage(error)}\r\n`,
      })
      this.post({ type: 'desktop.terminalExit', id, code: 1 })
    }
  }

  write(id: string, data: unknown): void {
    if (typeof data === 'string') {
      this.terminals.get(id)?.pty?.write(data)
    }
  }

  resize(id: string, cols: unknown, rows: unknown): void {
    const columns = size(cols, MAX_COLUMNS)
    const lines = size(rows, MAX_ROWS)
    if (columns && lines) {
      this.terminals.get(id)?.pty?.resize(columns, lines)
    }
  }

  close(id: string): void {
    const terminal = this.terminals.get(id)
    if (!terminal) {
      return
    }
    this.terminals.delete(id)
    if (terminal.timer) {
      clearTimeout(terminal.timer)
    }
    terminal.pty?.kill()
  }

  dispose(): void {
    for (const id of [...this.terminals.keys()]) {
      this.close(id)
    }
  }

  // Loaded on first use: a missing native module then breaks only the terminal, not the app.
  private async loadPty(): Promise<Pty> {
    this.pty ??= await import('node-pty')
    return this.pty
  }

  // Shells print in many small chunks. One message per frame keeps the window responsive.
  private queue(id: string, data: string): void {
    const terminal = this.terminals.get(id)
    if (!terminal) {
      return
    }
    terminal.pending += data
    terminal.timer ??= setTimeout(() => this.flush(id), FLUSH_MS)
  }

  private flush(id: string): void {
    const terminal = this.terminals.get(id)
    if (!terminal) {
      return
    }
    if (terminal.timer) {
      clearTimeout(terminal.timer)
      terminal.timer = null
    }
    if (terminal.pending) {
      this.post({ type: 'desktop.terminalData', id, data: terminal.pending })
      terminal.pending = ''
    }
  }
}
