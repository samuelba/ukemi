import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { describeArgs, JjRunner, summarizeStderr } from '../../src/jj/runner'
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
