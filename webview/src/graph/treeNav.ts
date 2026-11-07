import type { KeyboardEvent } from 'react'
import { HEAD_HEIGHT } from './GraphCell'
import { isMove, stepIndex, treeKeyAction } from './treeKeys'

export const TREE_ITEM = '[role="treeitem"]'

// Fields, buttons and the drop preview bar handle their own keys.
const OWN_KEYS = 'input, textarea, select, button, [contenteditable="true"], .drop-preview'

// The height of what scrolls the tree: the graph has no scroll box of its own in VS Code, the page
// scrolls, while the desktop app scrolls a pane.
function viewportHeight(element: HTMLElement): number {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node.clientHeight
    }
  }
  return window.innerHeight
}

export function focusTreeItem(item: HTMLElement): void {
  item.focus({ preventScroll: true })
  item.scrollIntoView({ block: 'nearest' })
}

// Moves focus through the visible rows of a tree: collapsed rows render no children, so the
// document order of the items is the visible order. Rows handle Enter, Space and opening or
// closing themselves, and mark the event handled. What they leave comes here: the moves, Right on
// an open row (to its first child) and Left on a closed row or a leaf (to its parent). The menu
// key is left to the browser, which fires `contextmenu` on the focused row.
export function onTreeKeyDown(
  event: KeyboardEvent<HTMLElement>,
  onMove?: (item: HTMLElement) => void,
): void {
  const target = event.target
  if (event.defaultPrevented || !(target instanceof HTMLElement) || target.closest(OWN_KEYS)) {
    return
  }
  const action = treeKeyAction(event)
  if (!action) {
    return
  }
  const tree = event.currentTarget
  const item = target.closest<HTMLElement>(TREE_ITEM)
  let next: HTMLElement | null
  if (isMove(action)) {
    const items = Array.from(tree.querySelectorAll<HTMLElement>(TREE_ITEM))
    const index = item ? items.indexOf(item) : -1
    const pageSize = Math.floor(viewportHeight(tree) / HEAD_HEIGHT) - 1
    next = items[stepIndex(action, index, items.length, pageSize)] ?? null
  } else if (action === 'expand' && item?.getAttribute('aria-expanded') === 'true') {
    next = item.querySelector<HTMLElement>(TREE_ITEM)
  } else if (action === 'collapse' && item && item.getAttribute('aria-expanded') !== 'true') {
    const parent = item.parentElement?.closest<HTMLElement>(TREE_ITEM) ?? null
    next = parent && tree.contains(parent) ? parent : null
  } else {
    return
  }
  // Also at the ends, so the arrows do not scroll the page instead.
  event.preventDefault()
  if (next && next !== item) {
    focusTreeItem(next)
    onMove?.(next)
  }
}
