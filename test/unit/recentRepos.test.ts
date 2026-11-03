import { describe, expect, test } from 'vitest'
import {
  forget,
  MAX_RECENT,
  readRecent,
  recentLabel,
  remember,
} from '../../src/desktop/recentRepos'

describe('readRecent', () => {
  test('keeps the stored paths in order', () => {
    expect(readRecent(['/a', '/b'])).toEqual(['/a', '/b'])
  })

  test('drops what is not a path, duplicates and the overflow', () => {
    expect(readRecent(['/a', 3, '', '/a', null, '/b'])).toEqual(['/a', '/b'])
    expect(readRecent({ '/a': true })).toEqual([])
    const many = Array.from({ length: MAX_RECENT + 5 }, (_, i) => `/r${i}`)
    expect(readRecent(many)).toHaveLength(MAX_RECENT)
  })
})

describe('remember', () => {
  test('puts the repository first and moves it there when listed', () => {
    expect(remember(['/a', '/b'], '/c')).toEqual(['/c', '/a', '/b'])
    expect(remember(['/a', '/b', '/c'], '/b')).toEqual(['/b', '/a', '/c'])
  })

  test('lets the oldest fall off', () => {
    const full = Array.from({ length: MAX_RECENT }, (_, i) => `/r${i}`)
    const next = remember(full, '/new')
    expect(next).toHaveLength(MAX_RECENT)
    expect(next[0]).toBe('/new')
    expect(next).not.toContain(`/r${MAX_RECENT - 1}`)
  })

  test('forget removes one repository', () => {
    expect(forget(['/a', '/b'], '/a')).toEqual(['/b'])
  })
})

describe('recentLabel', () => {
  test('shortens the home folder to ~', () => {
    expect(recentLabel('/home/me/src/repo', '/home/me')).toBe('~/src/repo')
  })

  test('keeps other paths, and the home folder itself, as they are', () => {
    expect(recentLabel('/srv/repo', '/home/me')).toBe('/srv/repo')
    expect(recentLabel('/home/meet/repo', '/home/me')).toBe('/home/meet/repo')
    expect(recentLabel('/home/me', '/home/me')).toBe('/home/me')
  })
})
