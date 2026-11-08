import { createContext } from 'react'
import type { DesktopRendererMessage } from '../../../shared/desktopProtocol'
import { postMessage } from '../shared/hostApi'

export type Save = (key: string, value: unknown) => void

export function sendSettings(message: DesktopRendererMessage): void {
  postMessage(message)
}

// Writes the global value, or the override of the repository the form shows.
export const SaveContext = createContext<Save>((key, value) =>
  sendSettings({ type: 'desktop.setSetting', key, value }),
)
