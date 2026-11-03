import { describe, expect, test } from 'vitest'
import { readZoom, stepZoom, ZOOM_FACTORS, zoomPercent } from '../../src/desktop/zoom'

describe('readZoom', () => {
  test('keeps a stored level and starts at 100% without one', () => {
    expect(readZoom(1.25)).toBe(1.25)
    expect(readZoom(undefined)).toBe(1)
    expect(readZoom('2')).toBe(1)
    expect(readZoom(Number.NaN)).toBe(1)
  })

  test('snaps a hand-edited factor to the nearest level', () => {
    expect(readZoom(1.3)).toBe(1.25)
    expect(readZoom(9)).toBe(3)
    expect(readZoom(0)).toBe(0.5)
  })
})

describe('stepZoom', () => {
  test('steps through the levels', () => {
    expect(stepZoom(1, 'in')).toBe(1.1)
    expect(stepZoom(1.1, 'in')).toBe(1.25)
    expect(stepZoom(1, 'out')).toBe(0.9)
    expect(stepZoom(2.5, 'reset')).toBe(1)
  })

  test('stays at the ends', () => {
    expect(stepZoom(ZOOM_FACTORS[0], 'out')).toBe(ZOOM_FACTORS[0])
    expect(stepZoom(ZOOM_FACTORS.at(-1) ?? 3, 'in')).toBe(3)
  })

  test('shows a factor as a whole percentage', () => {
    expect(zoomPercent(0.67)).toBe(67)
    expect(zoomPercent(1.25)).toBe(125)
  })
})
