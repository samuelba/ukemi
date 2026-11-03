import { describe, expect, test } from 'vitest'
import {
  acceleratorOf,
  formatAccelerator,
  isAccelerator,
  normalizeAccelerator,
  type KeyPress,
} from '../../shared/accelerators'

// A key press as a US keyboard sends it, unless `keyCode` says what the layout puts there.
function press(code: string, modifiers: Partial<KeyPress> = {}): KeyPress {
  const letter = /^Key([A-Z])$/.exec(code)?.[1]
  const digit = /^Digit([0-9])$/.exec(code)?.[1]
  const keyCode = (letter ?? digit)?.charCodeAt(0) ?? { Equal: 187, Minus: 189 }[code] ?? 0
  return {
    code,
    keyCode,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  }
}

describe('isAccelerator', () => {
  test('takes modifiers with one key, and function keys alone', () => {
    expect(isAccelerator('CmdOrCtrl+Shift+F')).toBe(true)
    expect(isAccelerator('Alt+=')).toBe(true)
    expect(isAccelerator('CmdOrCtrl+Plus')).toBe(true)
    expect(isAccelerator('F5')).toBe(true)
    expect(isAccelerator('Ctrl+num7')).toBe(true)
  })

  test('refuses plain keys, unknown names and repeated modifiers', () => {
    expect(isAccelerator('A')).toBe(false)
    expect(isAccelerator('Shift')).toBe(false)
    expect(isAccelerator('Hyper+A')).toBe(false)
    expect(isAccelerator('Ctrl+Ctrl+A')).toBe(false)
    expect(isAccelerator('Ctrl+AB')).toBe(false)
    expect(isAccelerator('')).toBe(false)
  })
})

describe('normalizeAccelerator', () => {
  test('ignores order, case and aliases', () => {
    expect(normalizeAccelerator('shift+control+f', 'linux')).toBe(
      normalizeAccelerator('Ctrl+Shift+F', 'linux'),
    )
    expect(normalizeAccelerator('Ctrl+Return', 'linux')).toBe(
      normalizeAccelerator('Control+Enter', 'linux'),
    )
  })

  test('treats CmdOrCtrl as Ctrl off macOS only', () => {
    expect(normalizeAccelerator('CmdOrCtrl+B', 'linux')).toBe(
      normalizeAccelerator('Ctrl+B', 'linux'),
    )
    expect(normalizeAccelerator('CmdOrCtrl+B', 'darwin')).not.toBe(
      normalizeAccelerator('Ctrl+B', 'darwin'),
    )
  })
})

describe('acceleratorOf', () => {
  test('writes Ctrl as CmdOrCtrl on Linux, and Cmd as CmdOrCtrl on macOS', () => {
    expect(acceleratorOf(press('KeyF', { ctrlKey: true, shiftKey: true }), 'linux')).toBe(
      'CmdOrCtrl+Shift+F',
    )
    expect(acceleratorOf(press('KeyF', { metaKey: true }), 'darwin')).toBe('CmdOrCtrl+F')
    expect(acceleratorOf(press('KeyF', { ctrlKey: true }), 'darwin')).toBe('Ctrl+F')
    expect(acceleratorOf(press('KeyF', { metaKey: true }), 'linux')).toBe('Super+F')
  })

  test('keeps the key under Shift, so Shift+1 stays 1', () => {
    expect(acceleratorOf(press('Digit1', { ctrlKey: true, shiftKey: true }), 'linux')).toBe(
      'CmdOrCtrl+Shift+1',
    )
    expect(acceleratorOf(press('Equal', { ctrlKey: true }), 'linux')).toBe('CmdOrCtrl+=')
    expect(acceleratorOf(press('ArrowUp', { altKey: true }), 'linux')).toBe('Alt+Up')
    expect(acceleratorOf(press('F7'), 'linux')).toBe('F7')
  })

  test('follows the keyboard layout for letters, as the menu does', () => {
    // Z on a Swiss or German keyboard sits where US keyboards have Y.
    const swissZ = press('KeyY', { keyCode: 90, ctrlKey: true })
    expect(acceleratorOf(swissZ, 'linux')).toBe('CmdOrCtrl+Z')
    const frenchA = press('KeyQ', { keyCode: 65, ctrlKey: true, shiftKey: true })
    expect(acceleratorOf(frenchA, 'linux')).toBe('CmdOrCtrl+Shift+A')
  })

  test('keeps the keys that are the same on every layout by their place', () => {
    expect(acceleratorOf(press('Numpad7', { keyCode: 103, ctrlKey: true }), 'linux')).toBe(
      'CmdOrCtrl+num7',
    )
    expect(acceleratorOf(press('F12', { keyCode: 123 }), 'linux')).toBe('F12')
  })

  test('waits for a key that the menu can bind', () => {
    expect(acceleratorOf(press('ControlLeft', { ctrlKey: true }), 'linux')).toBeNull()
    expect(acceleratorOf(press('KeyA'), 'linux')).toBeNull()
    expect(acceleratorOf(press('KeyA', { shiftKey: true }), 'linux')).toBe('Shift+A')
  })
})

describe('formatAccelerator', () => {
  test('writes the keys as Linux and Windows show them', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+F', 'linux')).toBe('Ctrl+Shift+F')
    expect(formatAccelerator('shift+cmdorctrl+plus', 'win32')).toBe('Ctrl+Shift++')
    expect(formatAccelerator('Ctrl+CmdOrCtrl+A', 'linux')).toBe('Ctrl+A')
  })

  test('uses the macOS symbols in their order', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+F', 'darwin')).toBe('⇧⌘F')
    expect(formatAccelerator('Ctrl+Alt+pageup', 'darwin')).toBe('⌃⌥PageUp')
  })

  test('leaves what it cannot read as it is', () => {
    expect(formatAccelerator('nonsense+', 'linux')).toBe('nonsense+')
  })
})
