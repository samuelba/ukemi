import { dialog, type BrowserWindow } from 'electron'
import type { Logger } from '../util/logger'

const CRASH_WINDOW_MS = 60_000
const MAX_CRASHES = 3
// Chromium's code for a load that a newer navigation replaced. It is not a failure.
const ERR_ABORTED = -3

// Whether a page that crashed at `now` should load again. A page that keeps crashing stays down,
// so a crash loop does not spin the CPU.
export function shouldReload(crashes: readonly number[], now: number): boolean {
  return crashes.filter((time) => now - time < CRASH_WINDOW_MS).length < MAX_CRASHES
}

export interface RecoveryHooks {
  // The page is gone and loads again. Whatever it showed must be sent again once it is ready.
  beforeReload(): void
  isClosed(): boolean
}

// Keeps a window usable when its page crashes, hangs or fails to load. Without this, a renderer
// crash leaves a white window that only closing fixes.
export function watchRenderer(window: BrowserWindow, logger: Logger, hooks: RecoveryHooks): void {
  const contents = window.webContents
  const crashes: number[] = []
  let isAsking = false

  contents.on('render-process-gone', (_event, details) => {
    if (hooks.isClosed() || details.reason === 'clean-exit') {
      return
    }
    const now = Date.now()
    logger.error(`the window's page stopped (${details.reason}, exit code ${details.exitCode})`)
    if (!shouldReload(crashes, now)) {
      logger.error('the page keeps crashing, so it is not loaded again')
      return
    }
    crashes.push(now)
    hooks.beforeReload()
    contents.reload()
  })

  window.on('unresponsive', () => {
    if (isAsking || hooks.isClosed()) {
      return
    }
    isAsking = true
    logger.warn('the window stopped responding')
    void dialog
      .showMessageBox(window, {
        type: 'warning',
        message: 'Ukemi is not responding.',
        detail: 'You can wait for it, or reload the window. Running terminals keep running.',
        buttons: ['Wait', 'Reload'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      .then(({ response }) => {
        isAsking = false
        // Crashing the page lets the handler above reload it and send everything again.
        if (response === 1 && !hooks.isClosed()) {
          contents.forcefullyCrashRenderer()
        }
      })
  })

  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === ERR_ABORTED) {
      return
    }
    logger.error(`the window's page did not load: ${description} (${code}) ${url}`)
    // The window shows itself once the page is ready, which a failed page never is.
    if (!window.isDestroyed() && !window.isVisible()) {
      window.show()
    }
  })
}
