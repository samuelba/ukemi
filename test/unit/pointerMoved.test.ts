import { describe, expect, it } from 'vitest'
import { pointerMoved } from '../../webview/src/shared/pointer'

describe('pointerMoved', () => {
  it('is false for the event a still pointer gets when content is drawn under it', () => {
    expect(pointerMoved({ movementX: 0, movementY: 0 })).toBe(false)
  })

  it('is true when the pointer moved along either axis', () => {
    expect(pointerMoved({ movementX: 3, movementY: 0 })).toBe(true)
    expect(pointerMoved({ movementX: 0, movementY: -1 })).toBe(true)
  })
})
