import { expect, test } from 'vitest'
import { aboutInfo, aboutText } from '../../src/desktop/about'

const runtime = {
  versions: { electron: '44.9.0', chrome: '150.0.1', node: '24.10.0' },
  platform: 'linux' as NodeJS.Platform,
  arch: 'x64',
  release: '7.2.13-200.fc44.x86_64',
  userData: '/home/u/.config/Ukemi',
}

test('collects the version, license and runtime of the app', () => {
  const info = aboutInfo({ path: '/usr/bin/jj', version: '0.46.0' }, runtime)
  expect(info).toMatchObject({
    name: 'Ukemi',
    version: expect.stringMatching(/^\d+\.\d+\.\d+/),
    license: 'MIT',
    website: 'https://samuelba.dev/ukemi',
    repository: 'https://github.com/samuelba/ukemi',
    jj: { path: '/usr/bin/jj', version: '0.46.0' },
    electron: '44.9.0',
    chromium: '150.0.1',
    node: '24.10.0',
    os: 'linux x64 7.2.13-200.fc44.x86_64',
  })
})

test('aboutText lists everything a bug report needs, one fact per line', () => {
  const text = aboutText(aboutInfo({ path: null, version: null }, runtime))
  expect(text).toMatch(/^Ukemi \d+\.\d+\.\d+/)
  expect(text).toContain('jj: not found')
  expect(text).toContain('Electron: 44.9.0')
  expect(text).toContain('OS: linux x64 7.2.13-200.fc44.x86_64')
})
