import { BrowserWindow } from 'electron'
import type { DesktopContext } from './context'
import { watchRenderer } from './rendererRecovery'
import { SAVE_DELAY_MS } from './windowBounds'

export interface SessionWindowEvents {
  title: string
  onFocus: () => void
  onClosed: () => void
  // The page crashed and loads again.
  beforeReload: () => void
  isClosed: () => boolean
}

export interface SessionWindow {
  window: BrowserWindow
  // Native dialogs need a mapped parent. On Wayland, a dialog on a hidden window kills the app.
  shown: Promise<void>
}

// Opens the window of a session where the last window was, and loads its page.
export function createSessionWindow(
  context: DesktopContext,
  events: SessionWindowEvents,
): SessionWindow {
  const saved = context.windowBounds()
  const window = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(saved.x !== undefined && saved.y !== undefined ? { x: saved.x, y: saved.y } : {}),
    minWidth: 720,
    minHeight: 480,
    title: events.title,
    show: false,
    backgroundColor: context.backgroundColor(),
    ...(process.platform === 'darwin' ? {} : { icon: context.paths.icon }),
    webPreferences: {
      preload: context.paths.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  })
  const shown = new Promise<void>((resolve) => {
    window.once('show', () => resolve())
    window.once('closed', () => resolve())
  })
  window.once('ready-to-show', () => {
    if (saved.isMaximized) {
      window.maximize()
    }
    window.show()
  })
  window.webContents.on('did-finish-load', () =>
    window.webContents.setZoomFactor(context.zoomFactor()),
  )
  window.on('focus', events.onFocus)
  rememberPlacement(context, window)
  window.on('closed', events.onClosed)
  context.guardNavigation(window)
  watchRenderer(window, context.logger, {
    beforeReload: events.beforeReload,
    isClosed: events.isClosed,
  })
  void window.loadURL(context.pageUrl('desktop'))
  return { window, shown }
}

// Resizing fires many events, so the place is written once the window stays still, and on close.
// The normal bounds are kept while maximized, so restoring goes back to them.
function rememberPlacement(context: DesktopContext, window: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const save = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) {
      return
    }
    const bounds = window.getNormalBounds()
    context.saveWindowBounds({ ...bounds, isMaximized: window.isMaximized() })
  }
  const later = () => {
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(save, SAVE_DELAY_MS)
  }
  window.on('resize', later)
  window.on('move', later)
  window.on('maximize', later)
  window.on('unmaximize', later)
  window.on('close', save)
}
