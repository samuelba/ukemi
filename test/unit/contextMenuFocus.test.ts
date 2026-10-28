import { describe, expect, test } from 'vitest'
import { createContextMenuGate } from '../../webview/src/graph/contextMenuFocus'

const SETTLE = 300

describe('createContextMenuGate', () => {
  test('opens at once when the webview had focus long ago', () => {
    const gate = createContextMenuGate(SETTLE)
    gate.onFocus(0)
    gate.onPointerDown(true)

    expect(gate.deferMs(5_000)).toBe(0)
  })

  test('waits a full settle period when the press came from outside the webview', () => {
    const gate = createContextMenuGate(SETTLE)
    gate.onPointerDown(false)
    gate.onFocus(1_000)

    expect(gate.deferMs(1_000)).toBe(SETTLE)
  })

  test('waits only the rest of the settle period after a recent focus', () => {
    const gate = createContextMenuGate(SETTLE)
    gate.onFocus(1_000)
    gate.onPointerDown(true)

    expect(gate.deferMs(1_100)).toBe(200)
  })

  test('a keyboard menu after a blurred press does not wait again', () => {
    const gate = createContextMenuGate(SETTLE)
    gate.onPointerDown(false)
    gate.onFocus(1_000)
    gate.deferMs(1_000)

    expect(gate.deferMs(2_000)).toBe(0)
  })

  test('opens at once on a keyboard menu without any focus event', () => {
    const gate = createContextMenuGate(SETTLE)

    expect(gate.deferMs(10)).toBe(0)
  })
})
