import { describe, expect, test } from 'vitest'
import {
  buildPrompt,
  cleanSuggestion,
  limitDiff,
  splitPatch,
} from '../../src/app/describeSuggest/prompt'
import { DescriptionSuggestions } from '../../src/app/describeSuggest/service'
import {
  CLI_SPECS,
  CliSuggester,
  SuggestionCancelled,
  type Suggester,
  type ToolRun,
} from '../../src/app/describeSuggest/suggesters'
import { readSettings, type Settings } from '../../src/app/settings'

function patch(path: string, body: string): string {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n${body}\n`
}

function settingsWith(values: Record<string, unknown>): Settings {
  const config = readSettings({
    get: <T>(key: string, fallback: T) => (values[key] ?? fallback) as T,
  })
  return { read: () => config } as unknown as Settings
}

function spec(id: string) {
  const found = CLI_SPECS.find((s) => s.id === id)
  if (!found) {
    throw new Error(`no spec ${id}`)
  }
  return found
}

describe('splitPatch', () => {
  test('splits a git patch into files', () => {
    const files = splitPatch(patch('a.ts', '+a') + patch('dir/b.ts', '+b'))

    expect(files.map((f) => f.path)).toEqual(['a.ts', 'dir/b.ts'])
    expect(files[1]?.text).toContain('+b')
  })
})

describe('limitDiff', () => {
  test('keeps a small diff as is', () => {
    const diff = patch('a.ts', '+a')

    expect(limitDiff(diff, 10_000)).toBe(diff)
  })

  test('leaves out lock files and binary files, and names them', () => {
    const binary =
      'diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n'
    const result = limitDiff(
      patch('src/a.ts', '+a') + patch('package-lock.json', '+x') + binary,
      10_000,
    )

    expect(result).toContain('+a')
    expect(result).not.toContain('+x')
    expect(result).toContain('[Diff omitted for: package-lock.json, logo.png]')
  })

  test('cuts the diff where the budget runs out', () => {
    const big = patch('a.ts', `+${'x'.repeat(500)}`)
    const result = limitDiff(big + patch('b.ts', '+b'), 100)

    expect(result).toContain('[… rest of a.ts truncated]')
    expect(result).toContain('[Diff omitted for: b.ts]')
    expect(Buffer.byteLength(result)).toBeLessThan(250)
  })

  test('does not split a multi-byte character', () => {
    const result = limitDiff(patch('a.txt', `+${'é'.repeat(100)}`), 60)

    expect(result).not.toContain('�')
  })
})

describe('buildPrompt', () => {
  const base = {
    description: '',
    stat: 'a.ts | 1 +',
    diff: patch('a.ts', '+a'),
    ancestorDescriptions: [],
    instructions: '',
  }

  test('contains the diff and the file summary', () => {
    const prompt = buildPrompt(base)

    expect(prompt).toContain('a.ts | 1 +')
    expect(prompt).toContain('+a')
    expect(prompt).not.toContain('Additional instructions')
    expect(prompt).not.toContain('current description')
  })

  test('adds instructions, recent descriptions and the current description', () => {
    const prompt = buildPrompt({
      ...base,
      description: 'wip',
      ancestorDescriptions: ['feat: one', 'fix: two'],
      instructions: 'Use Conventional Commits',
    })

    expect(prompt).toContain('Additional instructions:\nUse Conventional Commits')
    expect(prompt).toContain('---\nfeat: one\n---\nfix: two\n---')
    expect(prompt).toContain('keeping what is still accurate:\nwip')
  })
})

describe('cleanSuggestion', () => {
  test.each([
    ['  feat: x\n', 'feat: x'],
    ['\x1b[1mfeat: x\x1b[0m', 'feat: x'],
    ['```\nfeat: x\n\nbody\n```', 'feat: x\n\nbody'],
    ['```text\r\nfeat: x\r\n```', 'feat: x'],
  ])('cleans %j', (output, expected) => {
    expect(cleanSuggestion(output)).toBe(expected)
  })
})

describe('CLI_SPECS', () => {
  test('claude gets the prompt on stdin, without tools', () => {
    const { args, stdin } = spec('claude').invocation('PROMPT', { model: 'haiku' })

    expect(args).toEqual([
      '-p',
      '--output-format',
      'text',
      '--no-session-persistence',
      '--tools',
      '',
      '--model',
      'haiku',
    ])
    expect(stdin).toBe('PROMPT')
  })

  test('copilot gets the prompt on stdin', () => {
    const { args, stdin } = spec('copilot').invocation('PROMPT', { model: '' })

    expect(args).toEqual(['--silent', '--no-color'])
    expect(stdin).toBe('PROMPT')
  })

  test('cursor gets the prompt as the last argument, in ask mode', () => {
    const { args, stdin } = spec('cursor').invocation('PROMPT', { model: '' })

    expect(args).toEqual(['-p', '--trust', '--mode', 'ask', '--output-format', 'text', 'PROMPT'])
    expect(stdin).toBeUndefined()
  })
})

describe('CliSuggester', () => {
  const options = () => ({ model: '' })

  test('is available only when --version succeeds, and remembers it', async () => {
    let runs = 0
    const run: ToolRun = async () => {
      runs++
      return { stdout: 'not installed', stderr: '', code: 1 }
    }
    const suggester = new CliSuggester(spec('copilot'), options, run, () => 1_000)

    expect(await suggester.available()).toBe(false)
    expect(await suggester.available()).toBe(false)
    expect(runs).toBe(1)
  })

  test('is not available when the binary is missing', async () => {
    const run: ToolRun = async () => {
      throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })
    }

    expect(await new CliSuggester(spec('claude'), options, run).available()).toBe(false)
  })

  test('runs the tool in an empty folder and cleans its answer', async () => {
    const calls: { command: string; args: readonly string[]; cwd: string; stdin?: string }[] = []
    const run: ToolRun = async (command, args, opts) => {
      calls.push({ command, args, cwd: opts.cwd, stdin: opts.stdin })
      return { stdout: '```\nfeat: add x\n```\n', stderr: '', code: 0 }
    }
    const suggester = new CliSuggester(spec('claude'), options, run)

    const text = await suggester.suggest('PROMPT', new AbortController().signal)

    expect(text).toBe('feat: add x')
    expect(calls[0]?.command).toBe('claude')
    expect(calls[0]?.stdin).toBe('PROMPT')
    expect(calls[0]?.cwd).toMatch(/ukemi-suggest-/)
  })

  test('reports the end of stderr when the tool fails', async () => {
    const run: ToolRun = async () => ({ stdout: '', stderr: 'line1\nnot logged in', code: 2 })
    const suggester = new CliSuggester(spec('claude'), options, run)

    await expect(suggester.suggest('P', new AbortController().signal)).rejects.toThrow(
      'Claude failed: line1 not logged in',
    )
  })

  test('reports a cancelled run as cancelled', async () => {
    const controller = new AbortController()
    const run: ToolRun = async () => {
      controller.abort()
      return { stdout: '', stderr: '', code: 143 }
    }
    const suggester = new CliSuggester(spec('claude'), options, run)

    await expect(suggester.suggest('P', controller.signal)).rejects.toBeInstanceOf(
      SuggestionCancelled,
    )
  })
})

function fakeSuggester(id: string, available: boolean): Suggester {
  return {
    id,
    label: id.toUpperCase(),
    available: async () => available,
    suggest: async () => `from ${id}`,
  }
}

describe('DescriptionSuggestions', () => {
  const suggesters = [
    fakeSuggester('claude', true),
    fakeSuggester('copilot', false),
    fakeSuggester('cursor', true),
  ]

  test('lists the installed tools that the settings enable, in their order', async () => {
    const service = new DescriptionSuggestions(
      suggesters,
      settingsWith({ 'describeSuggest.tools': ['cursor', 'copilot', 'claude', 'unknown'] }),
    )

    expect(await service.list()).toEqual([
      { id: 'cursor', label: 'CURSOR' },
      { id: 'claude', label: 'CLAUDE' },
    ])
  })

  test('lists nothing when the settings enable no tool', async () => {
    const service = new DescriptionSuggestions(
      suggesters,
      settingsWith({ 'describeSuggest.tools': [] }),
    )

    expect(await service.list()).toEqual([])
  })

  test('refuses a tool the settings do not enable', async () => {
    const service = new DescriptionSuggestions(
      suggesters,
      settingsWith({ 'describeSuggest.tools': ['claude'] }),
    )
    const model = {} as never
    const commit = {} as never

    await expect(service.suggest(model, commit, 'cursor', 'r1')).rejects.toThrow(
      'Unknown suggester cursor',
    )
  })
})

describe('readSettings', () => {
  test('has defaults for the suggestion settings', () => {
    const config = settingsWith({}).read()

    expect(config.suggestTools).toEqual(['claude', 'copilot', 'cursor', 'vscode-lm'])
    expect(config.suggestModels).toEqual({})
    expect(config.suggestInstructions).toBe('')
    expect(config.suggestMaxDiffBytes).toBe(40_000)
  })

  test('drops values of the wrong type and clamps the diff size', () => {
    const config = settingsWith({
      'describeSuggest.tools': ['claude', 3],
      'describeSuggest.models': { claude: 'haiku', cursor: 5 },
      'describeSuggest.instructions': 7,
      'describeSuggest.maxDiffBytes': 10_000_000,
    }).read()

    expect(config.suggestTools).toEqual(['claude'])
    expect(config.suggestModels).toEqual({ claude: 'haiku' })
    expect(config.suggestInstructions).toBe('')
    expect(config.suggestMaxDiffBytes).toBe(100_000)
  })
})
