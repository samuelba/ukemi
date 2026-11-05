import type { DragEvent } from 'react'

const GHOST_OPACITY = '0.6'

/**
 * Chromium on X11 fades the drag image, but on Wayland the compositor draws it opaque. Drag a
 * faded copy of the element instead, so the ghost looks the same on both.
 */
export function setTranslucentDragImage(event: DragEvent<HTMLElement>): void {
  const source = event.currentTarget
  const rect = source.getBoundingClientRect()
  // Chromium paints the drag image without the dragged element's own opacity, so the faded copy
  // goes inside a plain wrapper and the wrapper is dragged.
  const wrapper = document.createElement('div')
  // The wrapper must be laid out to be painted, so it sits off screen rather than hidden.
  Object.assign(wrapper.style, {
    position: 'fixed',
    top: '-10000px',
    left: '0',
    width: `${rect.width}px`,
    pointerEvents: 'none',
  })
  const ghost = source.cloneNode(true) as HTMLElement
  ghost.removeAttribute('data-vscode-context')
  Object.assign(ghost.style, {
    opacity: GHOST_OPACITY,
    background: 'var(--vscode-sideBar-background, var(--vscode-editor-background))',
  })
  wrapper.appendChild(ghost)
  document.body.appendChild(wrapper)
  event.dataTransfer.setDragImage(wrapper, event.clientX - rect.left, event.clientY - rect.top)
  // The image is taken during dragstart, so the copy can go on the next task.
  setTimeout(() => wrapper.remove(), 0)
}
