import { describe, expect, test } from 'vitest'
import { wrapFocus } from '../../webview/src/shared/useModalFocus'

describe('wrapFocus', () => {
  test('lets Tab move on inside the dialog', () => {
    expect(wrapFocus(3, 0, false)).toBeNull()
    expect(wrapFocus(3, 1, false)).toBeNull()
    expect(wrapFocus(3, 2, true)).toBeNull()
  })

  test('wraps from the last element to the first and back', () => {
    expect(wrapFocus(3, 2, false)).toBe(0)
    expect(wrapFocus(3, 0, true)).toBe(2)
  })

  test('a single element keeps focus', () => {
    expect(wrapFocus(1, 0, false)).toBe(0)
    expect(wrapFocus(1, 0, true)).toBe(0)
  })

  test('brings focus from outside back in at the start or the end', () => {
    expect(wrapFocus(3, -1, false)).toBe(0)
    expect(wrapFocus(3, -1, true)).toBe(2)
  })

  test('has nothing to move to in an empty dialog', () => {
    expect(wrapFocus(0, -1, false)).toBeNull()
  })
})
