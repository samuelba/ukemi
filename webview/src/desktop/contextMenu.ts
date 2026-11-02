import type { DesktopRendererMessage } from '../../../shared/desktopProtocol'
import { mergeContexts } from '../../../shared/menus'
import { postMessage } from '../shared/hostApi'

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
      x: event.clientX,
      y: event.clientY,
    })
  }
  window.addEventListener('contextmenu', listener)
  return () => window.removeEventListener('contextmenu', listener)
}
