// The channel to the host: a VS Code webview, or a window of the standalone app.

interface VsCodeApi {
  postMessage(message: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

// What the standalone app's preload exposes. See src/desktop/preload.ts.
export interface DesktopBridge {
  postMessage(message: unknown): void
  onMessage(listener: (message: unknown) => void): void
  readonly platform: string
  // Where a file dropped on the window lives on disk.
  pathForFile(file: File): string
}

declare function acquireVsCodeApi(): VsCodeApi

declare global {
  interface Window {
    ukemiHost?: DesktopBridge
  }
}

const STATE_KEY = 'ukemi.webviewState'

function desktopApi(bridge: DesktopBridge): VsCodeApi {
  // The bridge hands messages over the context boundary. Re-dispatching them in this world gives
  // the webview the same `message` events as in VS Code.
  bridge.onMessage((data) => window.dispatchEvent(new MessageEvent('message', { data })))
  followColorScheme()
  return {
    postMessage: (message) => bridge.postMessage(message),
    getState: () => {
      try {
        const saved = localStorage.getItem(STATE_KEY)
        return saved === null ? undefined : JSON.parse(saved)
      } catch {
        return undefined
      }
    },
    setState: (state) => {
      try {
        localStorage.setItem(STATE_KEY, JSON.stringify(state))
      } catch {
        // Storage can be unavailable. The state is only a convenience.
      }
    },
  }
}

// VS Code puts its theme kind on <body>. The app follows the system theme the same way.
function followColorScheme(): void {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => {
    for (const element of [document.documentElement, document.body]) {
      element.classList.toggle('vscode-dark', query.matches)
      element.classList.toggle('vscode-light', !query.matches)
    }
  }
  if (document.body) {
    apply()
  } else {
    document.addEventListener('DOMContentLoaded', apply, { once: true })
  }
  query.addEventListener('change', apply)
}

function createApi(): VsCodeApi {
  if (typeof acquireVsCodeApi === 'function') {
    return acquireVsCodeApi()
  }
  if (typeof window !== 'undefined' && window.ukemiHost) {
    return desktopApi(window.ukemiHost)
  }
  return { postMessage: () => undefined, getState: () => undefined, setState: () => undefined }
}

const api: VsCodeApi = createApi()

export const isDesktop = typeof window !== 'undefined' && window.ukemiHost !== undefined

// Where a file dropped on the window lives, or '' outside the standalone app.
export function desktopPathForFile(file: File): string {
  return typeof window !== 'undefined' && window.ukemiHost ? window.ukemiHost.pathForFile(file) : ''
}

export function postMessage<T>(message: T): void {
  api.postMessage(message)
}

export function vscodeContext(context: Record<string, unknown>): string {
  return JSON.stringify({ preventDefaultContextMenuItems: true, ...context })
}
