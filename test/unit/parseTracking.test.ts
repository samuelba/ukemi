import { describe, expect, test } from 'vitest'
import { parseTracking } from '../../src/jj/parse'

const line = (fields: Record<string, unknown>) => `${JSON.stringify(fields)}\n`

describe('parseTracking', () => {
  test('keeps remote refs and drops local and git rows', () => {
    const output =
      line({ name: 'feature', remote: null, tracked: false, ahead: null, behind: null }) +
      line({ name: 'feature', remote: 'git', tracked: true, ahead: 0, behind: 0 }) +
      line({ name: 'feature', remote: 'origin', tracked: true, ahead: 2, behind: 1 }) +
      line({ name: 'feature', remote: 'fork', tracked: false, ahead: null, behind: null })

    expect(parseTracking(output)).toEqual([
      { name: 'feature', remote: 'origin', tracked: true, ahead: 2, behind: 1 },
      { name: 'feature', remote: 'fork', tracked: false, ahead: 0, behind: 0 },
    ])
  })

  test('rejects output it does not understand', () => {
    expect(() => parseTracking('{"name": 1}\n')).toThrow(/Unexpected bookmark tracking output/)
  })
})
