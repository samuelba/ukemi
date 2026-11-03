import type { ZoomStep } from '../../shared/desktopProtocol'

// The zoom levels View > Zoom In and Zoom Out step through, as in a browser.
export const ZOOM_FACTORS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const

export const DEFAULT_ZOOM = 1

// state.json can be edited by hand, so a stored factor snaps to the nearest level.
export function readZoom(stored: unknown): number {
  if (typeof stored !== 'number' || !Number.isFinite(stored)) {
    return DEFAULT_ZOOM
  }
  return ZOOM_FACTORS.reduce((best, factor) =>
    Math.abs(factor - stored) < Math.abs(best - stored) ? factor : best,
  )
}

// The level one step from `factor`. The ends of the list stay where they are.
export function stepZoom(factor: number, step: ZoomStep): number {
  if (step === 'reset') {
    return DEFAULT_ZOOM
  }
  const current = readZoom(factor)
  const index = ZOOM_FACTORS.indexOf(current as (typeof ZOOM_FACTORS)[number])
  const next = step === 'in' ? index + 1 : index - 1
  return ZOOM_FACTORS[Math.min(ZOOM_FACTORS.length - 1, Math.max(0, next))] ?? current
}

export function zoomPercent(factor: number): number {
  return Math.round(factor * 100)
}
