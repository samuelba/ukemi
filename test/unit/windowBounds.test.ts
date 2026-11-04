import { describe, expect, test } from 'vitest'
import { DEFAULT_PLACEMENT, readPlacement } from '../../src/desktop/windowBounds'

const SCREEN = { x: 0, y: 0, width: 1920, height: 1080 }

describe('readPlacement', () => {
  test('uses the default when nothing is stored', () => {
    expect(readPlacement(undefined, [SCREEN])).toEqual(DEFAULT_PLACEMENT)
  })

  test('uses the default for a broken size', () => {
    expect(readPlacement({ width: 'wide', height: 600 }, [SCREEN])).toEqual(DEFAULT_PLACEMENT)
    expect(readPlacement({ width: -5, height: 600 }, [SCREEN])).toEqual(DEFAULT_PLACEMENT)
  })

  test('reads the size of an older state.json without a position', () => {
    expect(readPlacement({ width: 1000, height: 700 }, [SCREEN])).toEqual({
      width: 1000,
      height: 700,
      isMaximized: false,
    })
  })

  test('restores the position and the maximized state', () => {
    const stored = { width: 1000, height: 700, x: 200, y: 100, isMaximized: true }
    expect(readPlacement(stored, [SCREEN])).toEqual(stored)
  })

  test('keeps a position on a second screen', () => {
    const right = { x: 1920, y: 0, width: 2560, height: 1440 }
    const stored = { width: 1000, height: 700, x: 2400, y: 200, isMaximized: false }
    expect(readPlacement(stored, [SCREEN, right])).toEqual(stored)
  })

  test('drops a position on a screen that is gone', () => {
    const stored = { width: 1000, height: 700, x: 2400, y: 200 }
    expect(readPlacement(stored, [SCREEN])).toEqual({
      width: 1000,
      height: 700,
      isMaximized: false,
    })
  })

  test('drops a position with the title bar above the screen', () => {
    const placement = readPlacement({ width: 1000, height: 700, x: 100, y: -300 }, [SCREEN])
    expect(placement.x).toBeUndefined()
  })
})
