interface VsCodeApi {
  postMessage(message: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

declare function acquireVsCodeApi(): VsCodeApi

const api: VsCodeApi =
  typeof acquireVsCodeApi === 'function'
    ? acquireVsCodeApi()
    : { postMessage: () => undefined, getState: () => undefined, setState: () => undefined }

export function postMessage<T>(message: T): void {
  api.postMessage(message)
}

export function vscodeContext(context: Record<string, unknown>): string {
  return JSON.stringify({ preventDefaultContextMenuItems: true, ...context })
}
