import { createContext, useContext } from 'react'
import { postMessage } from './hostApi'

// Where a view sends its messages and hears the host. A view in its own webview uses the window.
// The standalone app shows Split and Clean up as tabs, each on a channel of its own.
export interface HostChannel {
  post(message: unknown): void
  subscribe(listener: (message: unknown) => void): () => void
}

export const windowChannel: HostChannel = {
  post: (message) => postMessage(message),
  subscribe: (listener) => {
    const onMessage = (event: MessageEvent) => listener(event.data)
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  },
}

export const HostChannelContext = createContext<HostChannel>(windowChannel)

export function useHostChannel(): HostChannel {
  return useContext(HostChannelContext)
}

// The typed sender of a view, on the channel it is shown in.
export function useSend<T>(): (message: T) => void {
  const channel = useHostChannel()
  return (message) => channel.post(message)
}
