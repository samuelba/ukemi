// A webview panel as an app controller sees it: something to post to and close.
export interface PanelChannel<T> {
  post(message: T): PromiseLike<unknown>
  close(): void
  readonly isClosed: boolean
}

export type PanelHandler<T> = (message: T) => Promise<void>
