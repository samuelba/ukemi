import { describe, expect, test } from 'vitest'
import { isNewer, parseRelease, updateNotice } from '../../src/desktop/updateCheck'

const release = {
  tag_name: 'v0.9.0',
  html_url: 'https://github.com/samuelba/ukemi/releases/tag/v0.9.0',
}

describe('parseRelease', () => {
  test('reads the version and page of a release', () => {
    expect(parseRelease(release)).toEqual({
      version: '0.9.0',
      url: 'https://github.com/samuelba/ukemi/releases/tag/v0.9.0',
    })
  })

  test('ignores a release that is not a plain version of this repository', () => {
    expect(parseRelease({ ...release, tag_name: 'v0.9.0-beta.1' })).toBeNull()
    expect(parseRelease({ ...release, html_url: 'https://example.com/ukemi' })).toBeNull()
    expect(parseRelease({ message: 'API rate limit exceeded' })).toBeNull()
  })
})

describe('isNewer', () => {
  test('compares the parts as numbers', () => {
    expect(isNewer('0.10.0', '0.9.3')).toBe(true)
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
    expect(isNewer('0.9.0', '0.9.0')).toBe(false)
    expect(isNewer('0.8.9', '0.9.0')).toBe(false)
  })
})

describe('updateNotice', () => {
  const latest = { version: '0.9.0', url: release.html_url }

  test('offers a newer release the user did not skip', () => {
    expect(updateNotice('0.8.0', latest, undefined)).toEqual(latest)
    expect(updateNotice('0.8.0', latest, '0.9.0')).toBeNull()
    expect(updateNotice('0.9.0', latest, undefined)).toBeNull()
    expect(updateNotice('0.8.0', null, undefined)).toBeNull()
  })
})
