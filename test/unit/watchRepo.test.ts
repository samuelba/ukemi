import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { isInternal } from '../../src/desktop/adapters/watchRepo'

describe('isInternal', () => {
  test.each(['.jj', '.git', join('.jj', 'working_copy', 'checkout'), join('.git', 'index')])(
    'skips jj and git bookkeeping in %s',
    (name) => {
      expect(isInternal(name)).toBe(true)
    },
  )

  test.each([
    '.gitignore',
    '.gitattributes',
    join('.github', 'workflows', 'ci.yml'),
    '.jjconfig.toml',
    join('src', 'a.ts'),
  ])('reports a change to %s', (name) => {
    expect(isInternal(name)).toBe(false)
  })
})
