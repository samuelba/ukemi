import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  describeArgs,
  JjRunner,
  stderrWarnings,
  summarizeStderr,
  type JjWarning,
} from '../../src/jj/runner'
import { NULL_LOGGER } from '../../src/util/logger'

describe('JjRunner environment', () => {
  test('passes the extra environment to jj and keeps terminal prompts off', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ukemi-runner-'))
    const fake = join(dir, 'jj')
    writeFileSync(fake, '#!/bin/sh\necho "$GIT_ASKPASS $GIT_TERMINAL_PROMPT"\n', { mode: 0o700 })
    const runner = new JjRunner(fake, NULL_LOGGER)

    runner.setEnvironment({ GIT_ASKPASS: '/x/askpass.sh' })
    const { stdout } = await runner.run({ cwd: dir, args: ['status'] })
    rmSync(dir, { recursive: true, force: true })

    expect(stdout).toBe('/x/askpass.sh 0\n')
  })

  test('names the repository in the log', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ukemi-runner-'))
    const fake = join(dir, 'jj')
    writeFileSync(fake, '#!/bin/sh\necho "Error: boom" >&2\nexit 1\n', { mode: 0o700 })
    const lines: string[] = []
    const logger = {
      info: (message: string) => lines.push(message),
      warn: (message: string) => lines.push(message),
      error: (message: string) => lines.push(message),
    }
    const runner = new JjRunner(fake, logger)

    await expect(runner.run({ cwd: dir, args: ['status'] })).rejects.toThrow('boom')
    rmSync(dir, { recursive: true, force: true })

    const name = basename(dir)
    expect(lines[0]).toMatch(new RegExp(`^\\[${name}\\] jj status \\(\\d+ ms, exit 1\\)$`))
    expect(lines[1]).toBe(`[${name}] Error: boom`)
  })
})

describe('JjRunner warnings', () => {
  async function warningsOf(options: { background?: boolean; ignoreWorkingCopy?: boolean }) {
    const dir = mkdtempSync(join(tmpdir(), 'ukemi-runner-'))
    const fake = join(dir, 'jj')
    writeFileSync(
      fake,
      '#!/bin/sh\necho "Warning: No matching bookmarks for names: nope" >&2\necho "No bookmarks to delete." >&2\n',
      { mode: 0o700 },
    )
    const logged: string[] = []
    const shown: JjWarning[] = []
    const runner = new JjRunner(fake, { ...NULL_LOGGER, warn: (message) => logged.push(message) })
    runner.onWarning((warning) => shown.push(warning))
    try {
      await runner.run({ cwd: dir, args: ['bookmark', 'delete'], ...options })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    return { logged, shown: shown.map((warning) => warning.text) }
  }

  test('logs and reports the warnings of a command that succeeds', async () => {
    const { logged, shown } = await warningsOf({})
    expect(shown).toEqual(['No matching bookmarks for names: nope'])
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatch(/\] No matching bookmarks for names: nope$/)
  })

  test('only logs the warnings of reads and background commands', async () => {
    expect((await warningsOf({ background: true })).shown).toEqual([])
    expect((await warningsOf({ ignoreWorkingCopy: true })).shown).toEqual([])
    expect((await warningsOf({ background: true })).logged).toHaveLength(1)
  })
})

describe('stderrWarnings', () => {
  test('keeps the lines and hints that belong to each warning', () => {
    const stderr = [
      'Warning: Refused to snapshot some files:',
      '  big.bin: 2.0MiB (2097152 bytes); the maximum size allowed is 1.0MiB',
      'Hint: Run `jj file track` to track them.',
      'Working copy  (@) now at: abc',
      'Warning: No matching remotes for names: origin',
      '',
    ].join('\n')
    expect(stderrWarnings(stderr)).toEqual([
      'Refused to snapshot some files:\n  big.bin: 2.0MiB (2097152 bytes); the maximum size allowed is 1.0MiB\nHint: Run `jj file track` to track them.',
      'No matching remotes for names: origin',
    ])
  })

  test('ignores output that is not a warning', () => {
    expect(stderrWarnings('Nothing changed.\n')).toEqual([])
  })
})

describe('describeArgs', () => {
  test('hides templates and config values', () => {
    expect(
      describeArgs([
        'log',
        '-r',
        '@',
        '-T',
        'json(self)',
        '--config=merge-tools.ukemi-split.program="/x/y.sh"',
      ]),
    ).toBe('log -r @ -T <template> --config=merge-tools.ukemi-split.program=…')
  })

  test('shortens the operation a read is pinned to', () => {
    expect(describeArgs(['log', '-r', '@', `--at-op=${'ab12'.repeat(32)}`])).toBe(
      'log -r @ --at-op=ab12ab12ab12…',
    )
  })

  test('hides the password of a remote url', () => {
    expect(describeArgs(['git', 'clone', 'https://sam:secret@host/x.git', 'dir'])).toBe(
      'git clone https://***@host/x.git dir',
    )
  })

  test('truncates long arguments', () => {
    const revset = 'a'.repeat(200)
    expect(describeArgs(['log', '-r', revset])).toBe(`log -r ${'a'.repeat(120)}…`)
  })
})

describe('summarizeStderr', () => {
  test('keeps the error and drops hints', () => {
    const stderr = 'Warning: x\nError: Commit abc is immutable\nHint: Pass --ignore-immutable\n'
    expect(summarizeStderr(stderr)).toBe('Commit abc is immutable')
  })

  test('hides a url password', () => {
    expect(summarizeStderr('Error: failed to fetch https://sam:secret@host/x.git\n')).toBe(
      'failed to fetch https://***@host/x.git',
    )
  })

  test('falls back to a generic message', () => {
    expect(summarizeStderr('')).toBe('jj failed')
  })
})

describe.skipIf(process.platform === 'win32')('JjRunner timeout', () => {
  async function timesOut(script: string): Promise<number> {
    const dir = mkdtempSync(join(tmpdir(), 'ukemi-runner-'))
    const fake = join(dir, 'jj')
    writeFileSync(fake, `#!/bin/sh\n${script}\n`, { mode: 0o700 })
    const runner = new JjRunner(fake, NULL_LOGGER, { killGraceMs: 200 })
    const started = Date.now()
    try {
      await expect(
        runner.run({ cwd: dir, args: ['git', 'fetch'], timeoutMs: 200 }),
      ).rejects.toThrow('timed out')
      return Date.now() - started
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  test('ends a helper that holds the output pipes open', async () => {
    // Like ssh started by git: it inherits jj's pipes and outlives a SIGTERM to jj alone.
    expect(await timesOut('sleep 30 &\nwait')).toBeLessThan(5000)
  })

  test('kills a process that ignores SIGTERM', async () => {
    expect(await timesOut("trap '' TERM\nwhile :; do sleep 0.1; done")).toBeLessThan(5000)
  })
})

describe.skipIf(process.platform === 'win32')('JjRunner prompts', () => {
  test('does not count the time a prompt is open against the timeout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ukemi-runner-'))
    const fake = join(dir, 'jj')
    writeFileSync(fake, '#!/bin/sh\nsleep 0.6\necho done\n', { mode: 0o700 })
    const runner = new JjRunner(fake, NULL_LOGGER, { killGraceMs: 200 })
    try {
      const result = runner.run({ cwd: dir, args: ['git', 'push'], timeoutMs: 300 })
      await runner.whilePrompting(() => new Promise((resolve) => setTimeout(resolve, 500)))
      expect((await result).stdout).toBe('done\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('times out again once the prompt is answered', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ukemi-runner-'))
    const fake = join(dir, 'jj')
    writeFileSync(fake, '#!/bin/sh\nsleep 30\n', { mode: 0o700 })
    const runner = new JjRunner(fake, NULL_LOGGER, { killGraceMs: 200 })
    try {
      const result = runner.run({ cwd: dir, args: ['git', 'push'], timeoutMs: 300 })
      await runner.whilePrompting(() => new Promise((resolve) => setTimeout(resolve, 100)))
      await expect(result).rejects.toThrow('timed out')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
