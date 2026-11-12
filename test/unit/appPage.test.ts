import { describe, expect, test } from 'vitest'
import { isAppPage } from '../../src/desktop/appPage'

describe('isAppPage', () => {
  test.each(['ukemi://app/desktop/desktop.html', 'ukemi://app/desktop/desktop.html?x=1#y'])(
    'accepts the app page %s',
    (url) => {
      expect(isAppPage(url)).toBe(true)
    },
  )

  test.each([
    '',
    'not a url',
    'about:blank',
    'file:///home/user/desktop.html',
    'https://app/desktop/desktop.html',
    'ukemi://other/desktop/desktop.html',
    'ukemi://app.evil/desktop/desktop.html',
    'ukemi://user@app/desktop/desktop.html',
  ])('refuses %s', (url) => {
    expect(isAppPage(url)).toBe(false)
  })
})
