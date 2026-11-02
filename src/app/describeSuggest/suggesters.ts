import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { sharedTempDir } from '../../util/hostProcess'
import { runTool, type ToolRunOptions, type ToolRunResult } from '../../util/runTool'
import { cleanSuggestion } from './prompt'

// A tool that turns a prompt into a change description.
export interface Suggester {
  readonly id: string
  readonly label: string
  available(): Promise<boolean>
  suggest(prompt: string, signal: AbortSignal): Promise<string>
}

export interface SuggestOptions {
  // An empty value leaves the choice to the tool.
  model: string
}

interface Invocation {
  args: string[]
  stdin?: string
}

// How to ask a coding agent CLI for one answer without a session, tools or questions.
export interface CliSpec {
  id: string
  label: string
  binary: string
  invocation(prompt: string, options: SuggestOptions): Invocation
}

export const CLI_SPECS: readonly CliSpec[] = [
  {
    id: 'claude',
    label: 'Claude',
    binary: 'claude',
    invocation: (prompt, { model }) => ({
      args: [
        '-p',
        '--output-format',
        'text',
        '--no-session-persistence',
        '--tools',
        '',
        ...(model ? ['--model', model] : []),
      ],
      stdin: prompt,
    }),
  },
  {
    id: 'copilot',
    label: 'Copilot',
    binary: 'copilot',
    // A piped prompt runs once without `-p`. Without `--allow-*` flags no tool can run.
    invocation: (prompt, { model }) => ({
      args: ['--silent', '--no-color', ...(model ? ['--model', model] : [])],
      stdin: prompt,
    }),
  },
  {
    id: 'cursor',
    label: 'Cursor',
    binary: 'cursor-agent',
    // Ask mode is read-only. The prompt is an argument; the diff limit keeps it far below the
    // size the system allows for one.
    invocation: (prompt, { model }) => ({
      args: [
        '-p',
        '--trust',
        '--mode',
        'ask',
        '--output-format',
        'text',
        ...(model ? ['--model', model] : []),
        prompt,
      ],
    }),
  },
]

const SUGGEST_TIMEOUT_MS = 120_000
const PROBE_TIMEOUT_MS = 10_000
const MAX_OUTPUT = 1024 * 1024
const MISSING_RETRY_MS = 30_000

export type ToolRun = (
  command: string,
  args: readonly string[],
  options: ToolRunOptions,
) => Promise<ToolRunResult>

// Runs a coding agent CLI as a plain completion: in an empty folder, so that it neither reads
// nor changes the repository, and with the prompt as the only input.
export class CliSuggester implements Suggester {
  private known: { ok: boolean; at: number } | null = null

  constructor(
    private readonly spec: CliSpec,
    private readonly options: () => SuggestOptions,
    private readonly run: ToolRun = runTool,
    private readonly now: () => number = Date.now,
  ) {}

  get id(): string {
    return this.spec.id
  }

  get label(): string {
    return this.spec.label
  }

  // Requires `--version` to succeed: some systems ship a stub under the same name that only
  // explains how to install the real tool. A missing tool is looked for again after a while.
  async available(): Promise<boolean> {
    const known = this.known
    if (known && (known.ok || this.now() - known.at < MISSING_RETRY_MS)) {
      return known.ok
    }
    let ok: boolean
    try {
      const result = await this.run(this.spec.binary, ['--version'], {
        cwd: sharedTempDir(),
        timeoutMs: PROBE_TIMEOUT_MS,
        maxOutput: MAX_OUTPUT,
      })
      ok = result.code === 0
    } catch {
      ok = false
    }
    this.known = { ok, at: this.now() }
    return ok
  }

  async suggest(prompt: string, signal: AbortSignal): Promise<string> {
    const { args, stdin } = this.spec.invocation(prompt, this.options())
    const cwd = await mkdtemp(join(sharedTempDir(), 'ukemi-suggest-'))
    try {
      const result = await this.run(this.spec.binary, args, {
        cwd,
        stdin,
        env: { NO_COLOR: '1' },
        timeoutMs: SUGGEST_TIMEOUT_MS,
        maxOutput: MAX_OUTPUT,
        signal,
      })
      if (signal.aborted) {
        throw new SuggestionCancelled()
      }
      const text = cleanSuggestion(result.stdout)
      if (result.code !== 0 || !text) {
        throw new Error(failureMessage(this.spec.label, result))
      }
      return text
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }
}

export class SuggestionCancelled extends Error {
  constructor() {
    super('Cancelled')
  }
}

function failureMessage(label: string, result: ToolRunResult): string {
  const detail = cleanSuggestion(result.stderr || result.stdout)
    .split('\n')
    .slice(-3)
    .join(' ')
  const reason = detail || (result.code === 0 ? 'no answer' : `exit code ${result.code}`)
  return `${label} failed: ${reason}`
}
