import { describe, expect, test } from 'vitest'
import { repoLabel } from '../../src/repo/labels'

describe('repoLabel', () => {
  test('uses the folder name for a repo at the workspace root', () => {
    expect(repoLabel('/w/app', [{ name: 'app', path: '/w/app' }])).toBe('app')
  })

  test('uses the relative path for a nested repo', () => {
    expect(repoLabel('/w/ws/src/alpha', [{ name: 'ws', path: '/w/ws' }])).toBe('src/alpha')
  })

  test('prefixes the folder name in multi-root workspaces', () => {
    const folders = [
      { name: 'one', path: '/w/one' },
      { name: 'two', path: '/w/two' },
    ]
    expect(repoLabel('/w/two/lib', folders)).toBe('two/lib')
    expect(repoLabel('/w/one', folders)).toBe('one')
  })

  test('uses the base name for a repo outside the workspace folders', () => {
    expect(repoLabel('/elsewhere/repo', [{ name: 'a', path: '/w/a' }])).toBe('repo')
  })
})
