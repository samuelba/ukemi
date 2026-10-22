import { describe, expect, test } from 'vitest'
import { describeArgs, summarizeStderr } from '../../src/jj/runner'

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

  test('falls back to a generic message', () => {
    expect(summarizeStderr('')).toBe('jj failed')
  })
})
