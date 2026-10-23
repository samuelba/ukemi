export interface ModifierEvent {
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  getModifierState?: (key: 'Control' | 'Meta' | 'Alt') => boolean
}

export interface ModifierSnapshot {
  copy: boolean
  alt: boolean
}

const RECENT_COPY_MS = 400

function read(event: ModifierEvent): ModifierSnapshot {
  const down = (key: 'Control' | 'Meta' | 'Alt') => event.getModifierState?.(key) === true
  return {
    copy: event.ctrlKey || event.metaKey || down('Control') || down('Meta'),
    alt: event.altKey || down('Alt'),
  }
}

/** Drag events in the webview report Ctrl as up. Remember it from the key and the press. */
export function createModifierTracker() {
  let keyCopy = false
  let keyAlt = false
  let gestureCopy = false
  let gestureAlt = false
  let pointerDown = false
  let dragActive = false
  let forceDuplicate = false
  let copySeenAt = Number.NEGATIVE_INFINITY
  const listeners = new Set<() => void>()

  const emit = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  const buttonHeld = () => pointerDown || dragActive

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    get copyDown() {
      return keyCopy
    },
    snapshot(): ModifierSnapshot {
      return {
        copy: forceDuplicate || gestureCopy || keyCopy,
        alt: gestureAlt || keyAlt,
      }
    },
    onKey(event: ModifierEvent, now = Date.now()) {
      const next = read(event)
      if (next.copy) {
        copySeenAt = now
      }
      const changed = next.copy !== keyCopy || next.alt !== keyAlt
      keyCopy = next.copy
      keyAlt = next.alt
      if (next.copy) {
        gestureCopy = true
      }
      if (next.alt) {
        gestureAlt = true
      }
      if (changed && !buttonHeld()) {
        emit()
      }
    },
    onPointerDown(event: ModifierEvent, now = Date.now()) {
      pointerDown = true
      const next = read(event)
      const recent = now - copySeenAt < RECENT_COPY_MS
      if (next.copy) {
        keyCopy = true
        copySeenAt = now
      }
      if (next.alt) {
        keyAlt = true
      }
      gestureCopy = next.copy || keyCopy || recent
      gestureAlt = next.alt || keyAlt
    },
    onPointerUp() {
      pointerDown = false
    },
    onDragStart(event: ModifierEvent, immutable: boolean) {
      dragActive = true
      forceDuplicate = immutable
      const next = read(event)
      if (immutable || next.copy || keyCopy) {
        gestureCopy = true
      }
      if (next.alt || keyAlt) {
        gestureAlt = true
      }
    },
    onDragOver(event: ModifierEvent) {
      const next = read(event)
      if (next.copy) {
        gestureCopy = true
      }
      if (next.alt) {
        gestureAlt = true
      }
    },
    onDragEnd() {
      dragActive = false
      forceDuplicate = false
      pointerDown = false
    },
  }
}

export const dragModifiers = createModifierTracker()

let installed = false

export function installDragModifiers() {
  if (installed || typeof window === 'undefined') {
    return
  }
  installed = true
  const onKey = (event: KeyboardEvent) => dragModifiers.onKey(event)
  const onPointerDown = (event: PointerEvent | MouseEvent) => dragModifiers.onPointerDown(event)
  const onPointerUp = () => dragModifiers.onPointerUp()
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('keyup', onKey, true)
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('mousedown', onPointerDown, true)
  window.addEventListener('pointerup', onPointerUp, true)
  window.addEventListener('mouseup', onPointerUp, true)
}
