import { useEffect, useState } from 'react'
import type { DesktopRendererMessage, FontSpec } from '../../../shared/desktopProtocol'
import { desktopPathForFile, postMessage } from '../shared/hostApi'

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

// Only drags from outside the app carry files. The app's own drags (changes, files of a change,
// bookmarks, tabs) use their own types, so they never reach this.
function isOutsideFileDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') === true
}

// Folders and files dragged onto the window from the desktop open as repository tabs. Returns
// whether such a drag is over the window. An inner element that takes the drop itself (the
// editor) calls preventDefault first, and then the window leaves it alone.
export function useFolderDrop(): boolean {
  const [isOver, setIsOver] = useState(false)
  useEffect(() => {
    // Enter and leave fire for every element crossed, so count them.
    let depth = 0
    const onEnter = (event: DragEvent) => {
      if (isOutsideFileDrag(event)) {
        depth += 1
        setIsOver(true)
      }
    }
    const onLeave = (event: DragEvent) => {
      if (isOutsideFileDrag(event)) {
        depth = Math.max(0, depth - 1)
        setIsOver(depth > 0)
      }
    }
    const onOver = (event: DragEvent) => {
      if (!isOutsideFileDrag(event) || event.defaultPrevented || !event.dataTransfer) {
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (event: DragEvent) => {
      if (!isOutsideFileDrag(event)) {
        return
      }
      depth = 0
      setIsOver(false)
      if (event.defaultPrevented || !event.dataTransfer) {
        return
      }
      event.preventDefault()
      const paths = [...event.dataTransfer.files].map(desktopPathForFile).filter(Boolean)
      if (paths.length > 0) {
        postMessage<DesktopRendererMessage>({ type: 'desktop.openPaths', paths })
      }
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])
  return isOver
}
