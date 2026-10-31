import { describe, expect, test } from 'vitest'
import {
  bodyAfterTitle,
  bookmarkSlug,
  combineDescriptions,
  firstLine,
  validateBookmarkName,
  validateRemoteName,
  redactUrlCredentials,
  validateRemoteUrl,
} from '../../src/util/text'

describe('descriptions', () => {
  test('splits title and body', () => {
    expect(firstLine('feat: add x\n\nmore')).toBe('feat: add x')
    expect(bodyAfterTitle('feat: add x\n\nmore\nlines\n')).toBe('more\nlines')
  })

  test('combines non-empty descriptions with a blank line', () => {
    expect(combineDescriptions('parent\n', 'child\n')).toBe('parent\n\nchild')
    expect(combineDescriptions('', 'child')).toBe('child')
    expect(combineDescriptions('parent', '  ')).toBe('parent')
  })
})

describe('bookmarkSlug', () => {
  test('slugifies the first line', () => {
    expect(bookmarkSlug('Fix the Login Bug!\nbody', 'abcdefghij')).toBe('fix-the-login-bug')
  })

  test('keeps the conventional commit type as a prefix', () => {
    expect(bookmarkSlug('feat(ui): Add repo picker', 'x')).toBe('feat-ui-add-repo-picker')
  })

  test('limits the length and trims dashes', () => {
    const slug = bookmarkSlug('a'.repeat(30) + ' ' + 'b'.repeat(30), 'x')
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug.endsWith('-')).toBe(false)
  })

  test('falls back to the change id', () => {
    expect(bookmarkSlug('', 'qpvuntsmwlqt')).toBe('ukemi/qpvuntsm')
  })
})

describe('validateBookmarkName', () => {
  test.each(['main', 'feat/x', 'user.name/topic-1'])('accepts %s', (name) => {
    expect(validateBookmarkName(name)).toBeNull()
  })

  test.each(['', '-x', 'a b', 'a..b', 'x.lock', 'x/', 'a:b'])('rejects %j', (name) => {
    expect(validateBookmarkName(name)).not.toBeNull()
  })
})

describe('validateRemoteUrl', () => {
  test.each([
    '',
    'https://github.com/org/repo.git',
    'git@github.com:org/repo.git',
    '/tmp/repo.git',
  ])('accepts %j', (url) => {
    expect(validateRemoteUrl(url)).toBeNull()
  })

  test('rejects a value that is not a url', () => {
    expect(validateRemoteUrl('not a url')).not.toBeNull()
  })

  test.each([
    'https://sam:secret@github.com/org/repo.git',
    'https://ghp_abc123@github.com/org/repo.git',
    'https://glpat-abc123@gitlab.com/org/repo.git',
  ])('rejects credentials in %j', (url) => {
    expect(validateRemoteUrl(url)).toContain('password or token')
  })

  test('accepts a user name without a password', () => {
    expect(validateRemoteUrl('https://sam@github.com/org/repo.git')).toBeNull()
    expect(validateRemoteUrl('ssh://git@github.com/org/repo.git')).toBeNull()
  })
})

describe('redactUrlCredentials', () => {
  test('hides the password of a url', () => {
    expect(redactUrlCredentials('clone https://sam:secret@host/x.git now')).toBe(
      'clone https://***@host/x.git now',
    )
  })

  test('keeps urls without a password', () => {
    const text = 'ssh://git@host/x.git https://host:8443/x.git'
    expect(redactUrlCredentials(text)).toBe(text)
  })
})

describe('validateRemoteName', () => {
  test('accepts origin', () => {
    expect(validateRemoteName('origin')).toBeNull()
  })

  test.each(['', '  ', 'a..b'])('rejects %j', (name) => {
    expect(validateRemoteName(name)).not.toBeNull()
  })
})
