export interface Area {
  x: number
  y: number
  width: number
  height: number
}

// What a window remembers: its size and place when not maximized, and whether it was maximized.
export interface WindowPlacement {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

export const DEFAULT_PLACEMENT: WindowPlacement = { width: 1280, height: 860, isMaximized: false }

// How long the window must stay still before its place is written to disk.
export const SAVE_DELAY_MS = 500

// How much of the title bar must be on a screen for a saved position to be used.
const VISIBLE_PX = 64

function isSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function titleBarOn(window: Area, screen: Area): boolean {
  const shared =
    Math.min(window.x + window.width, screen.x + screen.width) - Math.max(window.x, screen.x)
  return shared >= VISIBLE_PX && window.y >= screen.y && window.y < screen.y + screen.height
}

// Reads the stored placement. state.json can be edited by hand, and a screen can be unplugged
// since, so a position that would put the title bar off every screen is dropped and the window
// opens centered.
export function readPlacement(stored: unknown, screens: readonly Area[]): WindowPlacement {
  const saved = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<
    string,
    unknown
  >
  if (!isSize(saved.width) || !isSize(saved.height)) {
    return DEFAULT_PLACEMENT
  }
  const placement: WindowPlacement = {
    width: Math.round(saved.width),
    height: Math.round(saved.height),
    isMaximized: saved.isMaximized === true,
  }
  if (!isCoordinate(saved.x) || !isCoordinate(saved.y)) {
    return placement
  }
  const area = { x: saved.x, y: saved.y, width: placement.width, height: placement.height }
  return screens.some((screen) => titleBarOn(area, screen))
    ? { ...placement, x: Math.round(saved.x), y: Math.round(saved.y) }
    : placement
}
