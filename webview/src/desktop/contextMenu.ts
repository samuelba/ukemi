import type { DesktopRendererMessage } from '../../../shared/desktopProtocol'
import { mergeContexts } from '../../../shared/menus'
import { postMessage } from '../shared/hostApi'

// The menu key and Shift+F10 can fire the event without a pointer position. The menu then opens
// at the focused row.
function menuPoint(event: MouseEvent, target: Element | null): { x: number; y: number } {
  if (event.clientX !== 0 || event.clientY !== 0 || !target) {
    return { x: event.clientX, y: event.clientY }
  }
  // An open row holds its files, so the menu goes under the row's own line.
  const line = target.querySelector(':scope > .commit-body > .commit-head, :scope > .file-dir-row')
  const rect = (line ?? target).getBoundingClientRect()
  return { x: Math.round(rect.left + 16), y: Math.round(rect.bottom) }
}

// VS Code builds a webview's context menu from `data-vscode-context` on the clicked element and
// its ancestors. The app does the same and asks the main process for a native menu.
export function installContextMenus(): () => void {
  const listener = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('input, textarea, [contenteditable="true"]')) {
      return
    }
    const contexts: string[] = []
    for (let node: Element | null = target; node; node = node.parentElement) {
      const raw = node.getAttribute('data-vscode-context')
      if (raw) {
        contexts.push(raw)
      }
    }
    event.preventDefault()
    if (contexts.length === 0) {
      return
    }
    const context = mergeContexts(contexts)
    delete context.preventDefaultContextMenuItems
    postMessage<DesktopRendererMessage>({
      type: 'desktop.contextMenu',
      context,
      ...menuPoint(event, target),
    })
  }
  window.addEventListener('contextmenu', listener)
  return () => window.removeEventListener('contextmenu', listener)
}
