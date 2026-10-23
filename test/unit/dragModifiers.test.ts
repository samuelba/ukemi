import { describe, expect, test } from 'vitest'
import { createModifierTracker } from '../../webview/src/graph/dragModifiers'

const up = { ctrlKey: false, metaKey: false, altKey: false }
const ctrl = { ctrlKey: true, metaKey: false, altKey: false }
const ctrlAlt = { ctrlKey: true, metaKey: false, altKey: true }

describe('createModifierTracker', () => {
  test('keeps Ctrl from the pointer press when the drag events omit it', () => {
    const tracker = createModifierTracker()
    tracker.onPointerDown(ctrl)
    tracker.onDragStart(up, false)
    tracker.onDragOver(up)

    expect(tracker.snapshot()).toEqual({ copy: true, alt: false })
  })

  test('keeps Alt from the pointer press when the drop event omits it', () => {
    const tracker = createModifierTracker()
    tracker.onPointerDown(ctrlAlt)
    tracker.onDragStart(up, false)
    tracker.onDragOver(up)

    expect(tracker.snapshot()).toEqual({ copy: true, alt: true })
  })

  test('a keyup during the drag does not turn the gesture into a rebase', () => {
    const tracker = createModifierTracker()
    tracker.onPointerDown(ctrl)
    tracker.onDragStart(ctrl, false)
    tracker.onKey(up)

    expect(tracker.snapshot().copy).toBe(true)
  })

  test('a plain drag stays a rebase', () => {
    const tracker = createModifierTracker()
    tracker.onPointerDown(up)
    tracker.onDragStart(up, false)

    expect(tracker.snapshot()).toEqual({ copy: false, alt: false })
  })

  test('an immutable drag stays a duplicate after Ctrl is reported up', () => {
    const tracker = createModifierTracker()
    tracker.onPointerDown(ctrl)
    tracker.onDragStart(up, true)
    tracker.onKey(up)

    expect(tracker.snapshot().copy).toBe(true)
  })

  test('a pointer press that omits Ctrl does not cancel a held Control key', () => {
    const tracker = createModifierTracker()
    tracker.onKey(ctrl)
    tracker.onPointerDown(up)
    tracker.onDragStart(up, false)
    tracker.onDragOver(up)

    expect(tracker.snapshot().copy).toBe(true)
  })

  test('a keyup before dragstart still duplicates', () => {
    const tracker = createModifierTracker()
    const pressedAt = 5_000
    tracker.onKey(ctrl, pressedAt)
    tracker.onPointerDown(ctrl, pressedAt + 10)
    tracker.onKey(up, pressedAt + 20)
    tracker.onDragStart(up, false)
    tracker.onDragOver(up)

    expect(tracker.snapshot()).toEqual({ copy: true, alt: false })
  })

  test('Ctrl released just before the press still duplicates', () => {
    const tracker = createModifierTracker()
    const pressedAt = 5_000
    tracker.onKey(ctrl, pressedAt)
    tracker.onKey(up, pressedAt + 30)
    tracker.onPointerDown(up, pressedAt + 40)
    tracker.onDragStart(up, false)

    expect(tracker.snapshot().copy).toBe(true)
  })

  test('the next press without Ctrl is a rebase', () => {
    const tracker = createModifierTracker()
    const pressedAt = 5_000
    tracker.onPointerDown(ctrl, pressedAt)
    tracker.onDragStart(up, false)
    tracker.onDragEnd()
    tracker.onKey(up, pressedAt + 10)
    tracker.onPointerDown(up, pressedAt + 1_000)
    tracker.onDragStart(up, false)

    expect(tracker.snapshot()).toEqual({ copy: false, alt: false })
  })
})
