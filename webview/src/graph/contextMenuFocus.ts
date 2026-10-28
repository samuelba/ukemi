/** VS Code polls webview focus every 250 ms and closes an open menu when it reports the change. */
const FOCUS_SETTLE_MS = 300

export function createContextMenuGate(settleMs = FOCUS_SETTLE_MS) {
  let focusedAt = Number.NEGATIVE_INFINITY
  let pressedBlurred = false

  return {
    onFocus(now: number) {
      focusedAt = now
    },
    onPointerDown(focused: boolean) {
      pressedBlurred = !focused
    },
    deferMs(now: number): number {
      const wait = pressedBlurred ? settleMs : Math.max(0, focusedAt + settleMs - now)
      pressedBlurred = false
      return wait
    },
  }
}

function replay(event: MouseEvent): MouseEventInit {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    button: event.button,
    buttons: event.buttons,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  }
}

let installed = false

/** Holds the first right-click until VS Code has seen the webview take focus, then replays it. */
export function installContextMenuFocusFix() {
  if (installed || typeof window === 'undefined') {
    return
  }
  installed = true
  const gate = createContextMenuGate()
  let pending: ReturnType<typeof setTimeout> | undefined

  const cancelPending = () => {
    clearTimeout(pending)
    pending = undefined
  }

  window.addEventListener('focus', () => gate.onFocus(performance.now()))
  window.addEventListener(
    'pointerdown',
    () => {
      cancelPending()
      gate.onPointerDown(document.hasFocus())
    },
    true,
  )
  window.addEventListener(
    'contextmenu',
    (event) => {
      if (!event.isTrusted) {
        return
      }
      const wait = gate.deferMs(performance.now())
      if (wait === 0) {
        return
      }
      event.preventDefault()
      cancelPending()
      const init = replay(event)
      const target = event.target instanceof Element ? event.target : null
      pending = setTimeout(() => {
        pending = undefined
        const element = target?.isConnected
          ? target
          : document.elementFromPoint(init.clientX ?? 0, init.clientY ?? 0)
        element?.dispatchEvent(new MouseEvent('contextmenu', init))
      }, wait)
    },
    true,
  )
}
