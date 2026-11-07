import { describe, expect, test } from 'vitest'
import { checkElapsed, pipelineSpan } from '../../shared/ciTiming'
import type { CiCheck } from '../../shared/protocol'

const now = Date.parse('2026-11-07T12:10:00Z')

function check(overrides: Partial<CiCheck>): CiCheck {
  return { name: 'job', state: 'success', url: '', ...overrides }
}

describe('checkElapsed', () => {
  test('measures a finished job from start to finish', () => {
    const job = check({ startedAt: '2026-11-07T12:00:00Z', finishedAt: '2026-11-07T12:03:12Z' })
    expect(checkElapsed(job, now)).toBe(192_000)
  })

  test('measures a running job up to now', () => {
    const job = check({ state: 'pending', startedAt: '2026-11-07T12:05:00Z' })
    expect(checkElapsed(job, now)).toBe(300_000)
  })

  test('has no time for a job that never started', () => {
    expect(checkElapsed(check({ state: 'pending' }), now)).toBeUndefined()
    expect(checkElapsed(check({ state: 'manual' }), now)).toBeUndefined()
  })

  test('has no time for a job that stopped without a finish time', () => {
    expect(checkElapsed(check({ startedAt: '2026-11-07T12:00:00Z' }), now)).toBeUndefined()
  })

  test('ignores unparsable timestamps', () => {
    expect(checkElapsed(check({ startedAt: 'nope', finishedAt: 'nope' }), now)).toBeUndefined()
  })
})

describe('pipelineSpan', () => {
  test('spans the earliest start to the latest finish once all jobs are done', () => {
    const span = pipelineSpan([
      check({ startedAt: '2026-11-07T12:01:00Z', finishedAt: '2026-11-07T12:04:00Z' }),
      check({ startedAt: '2026-11-07T12:00:00Z', finishedAt: '2026-11-07T12:02:00Z' }),
      check({ state: 'skipped' }),
    ])
    expect(span).toEqual({ startedAt: '2026-11-07T12:00:00Z', finishedAt: '2026-11-07T12:04:00Z' })
  })

  test('has no finish while a job is still pending', () => {
    const span = pipelineSpan([
      check({ startedAt: '2026-11-07T12:00:00Z', finishedAt: '2026-11-07T12:02:00Z' }),
      check({ state: 'pending' }),
    ])
    expect(span).toEqual({ startedAt: '2026-11-07T12:00:00Z' })
  })

  test('is empty when no job started', () => {
    expect(pipelineSpan([check({ state: 'manual' })])).toEqual({})
    expect(pipelineSpan([])).toEqual({})
  })
})
