import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react'

const TABBABLE = 'button, input, textarea, select, a[href], [tabindex]'

// Where focus goes when what had it is gone: the graph's tab stop. Describe opens from a row that a
// refresh may have replaced meanwhile.
const FALLBACK = '.graph [role="treeitem"][tabindex="0"]'

// The element Tab moves to, or null when the browser's own move stays inside the dialog. `index` is
// the focused element's place among the `count` tabbable ones, -1 when focus is outside them.
export function wrapFocus(count: number, index: number, shift: boolean): number | null {
  if (count === 0) {
    return null
  }
  if (index < 0) {
    return shift ? count - 1 : 0
  }
  if (shift && index === 0) {
    return count - 1
  }
  if (!shift && index === count - 1) {
    return 0
  }
  return null
}

function tabbables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !(element as HTMLButtonElement).disabled &&
      element.getClientRects().length > 0,
  )
}

const MODAL = '[aria-modal="true"]'

// What each open dialog gives focus back to. A dialog opened from another (the palette running a
// command that asks for input) gives focus back to where the first one would have.
const restoreTargets = new WeakMap<Element, HTMLElement | null>()

function restoreTargetFor(active: Element | null): HTMLElement | null {
  const modal = active?.closest(MODAL)
  if (modal && restoreTargets.has(modal)) {
    return restoreTargets.get(modal) ?? null
  }
  return active instanceof HTMLElement ? active : null
}

function restoreFocus(previous: HTMLElement | null): void {
  // Another dialog that opened as this one closed keeps the focus it took.
  if (document.activeElement?.closest(MODAL)) {
    return
  }
  // A row's action buttons are out of the tab order, so focus goes back to their row.
  const owner = previous?.closest<HTMLElement>('[role="treeitem"]') ?? previous
  const back =
    owner?.isConnected && owner !== document.body
      ? owner
      : document.querySelector<HTMLElement>(FALLBACK)
  back?.focus({ preventScroll: true })
}

interface ModalFocusOptions {
  // Takes focus when the dialog opens, instead of its first tabbable element.
  initial?: RefObject<HTMLElement | null>
  // Escape on the dialog itself, which has focus after a click on its text. Its fields handle
  // their own Escape.
  onEscape?: () => void
}

// Makes a dialog modal for focus. It takes focus when it opens (`initial`, or the first tabbable
// element, unless a child already took it with autoFocus), keeps Tab and Shift+Tab inside, and
// gives focus back when it closes. Returns the keydown handler for the dialog element, which
// needs tabIndex -1 so that a click on its text keeps focus inside.
export function useModalFocus(
  container: RefObject<HTMLElement | null>,
  { initial, onEscape }: ModalFocusOptions = {},
): (event: KeyboardEvent) => void {
  // Read while rendering: an autoFocus child takes focus before any effect runs.
  const [previous] = useState(() =>
    typeof document === 'undefined' ? null : restoreTargetFor(document.activeElement),
  )

  useEffect(() => {
    const dialog = container.current
    if (dialog) {
      restoreTargets.set(dialog, previous)
      if (!dialog.contains(document.activeElement)) {
        ;(initial?.current ?? tabbables(dialog)[0])?.focus()
      }
    }
    return () => restoreFocus(previous)
    // Once per dialog: what to give focus back to is fixed when it opens.
  }, [])

  return (event: KeyboardEvent) => {
    const dialog = container.current
    if (!dialog) {
      return
    }
    if (event.key === 'Escape' && event.target === dialog && onEscape) {
      event.preventDefault()
      onEscape()
      return
    }
    if (event.key !== 'Tab') {
      return
    }
    const elements = tabbables(dialog)
    if (elements.length === 0) {
      event.preventDefault()
      return
    }
    const index = elements.indexOf(document.activeElement as HTMLElement)
    const target = wrapFocus(elements.length, index, event.shiftKey)
    if (target !== null) {
      event.preventDefault()
      elements[target]?.focus()
    }
  }
}
