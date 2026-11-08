import { useEffect } from 'react'
import type { DesktopRendererMessage, FontSpec } from '../../../shared/desktopProtocol'
import { postMessage } from '../shared/hostApi'

// What the whole window does with keys, the mouse wheel and the editor font.

export function run(command: string): void {
  postMessage<DesktopRendererMessage>({ type: 'desktop.run', command })
}

// The diff view, ids and paths read these tokens, which tokens.css sets to a default.
export function applyEditorFont(font: FontSpec): void {
  const root = document.documentElement.style
  root.setProperty('--vscode-editor-font-family', font.family)
  root.setProperty('--vscode-editor-font-size', `${font.size}px`)
  root.setProperty('--vscode-editor-font-weight', font.weight)
}

function isEditing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

// Keys VS Code users expect, minus the ones the native menu already binds.
export function useShortcuts(openPalette: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'F1') {
        event.preventDefault()
        openPalette()
        return
      }
      const mod = event.metaKey || event.ctrlKey
      if (
        !mod ||
        isEditing(event.target) ||
        document.querySelector('.split, .cleanup')?.contains(event.target as Node)
      ) {
        return
      }
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault()
        run(event.shiftKey ? 'ukemi.redo' : 'ukemi.undo')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openPalette])
}

// Ctrl or Cmd with the mouse wheel, or a pinch on a touchpad, zooms the window like View > Zoom.
// A touchpad sends a burst of small events, so one step waits for the last to settle.
const WHEEL_STEP_MS = 120

export function useWheelZoom(): void {
  useEffect(() => {
    let lastStep = 0
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) {
        return
      }
      event.preventDefault()
      if (event.timeStamp - lastStep < WHEEL_STEP_MS) {
        return
      }
      lastStep = event.timeStamp
      postMessage<DesktopRendererMessage>({
        type: 'desktop.zoom',
        step: event.deltaY < 0 ? 'in' : 'out',
      })
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])
}
