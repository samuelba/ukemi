// Keyboard shortcuts in Electron's accelerator syntax, like `CmdOrCtrl+Shift+F`. The app menu
// takes them as they are. The settings form records them from key presses and shows them.

const MODIFIERS: Readonly<Record<string, string>> = {
  command: 'cmdorctrl',
  cmd: 'cmdorctrl',
  commandorcontrol: 'cmdorctrl',
  cmdorctrl: 'cmdorctrl',
  control: 'ctrl',
  ctrl: 'ctrl',
  alt: 'alt',
  option: 'alt',
  altgr: 'altgr',
  shift: 'shift',
  super: 'super',
  meta: 'super',
}

const NAMED_KEYS = new Set([
  'plus',
  'space',
  'tab',
  'capslock',
  'numlock',
  'scrolllock',
  'backspace',
  'delete',
  'insert',
  'return',
  'enter',
  'up',
  'down',
  'left',
  'right',
  'home',
  'end',
  'pageup',
  'pagedown',
  'escape',
  'esc',
  'printscreen',
  'numdec',
  'numadd',
  'numsub',
  'nummult',
  'numdiv',
])

const KEY_ALIASES: Readonly<Record<string, string>> = { return: 'enter', esc: 'escape' }

const PUNCTUATION = ')!@#$%^&*(:;<,_->.?/~`{][|\\}"\'='

const FUNCTION_KEY = /^f([1-9]|1[0-9]|2[0-4])$/

function isKey(part: string): boolean {
  const key = part.toLowerCase()
  return (
    /^[a-z0-9]$/.test(key) ||
    FUNCTION_KEY.test(key) ||
    /^num[0-9]$/.test(key) ||
    NAMED_KEYS.has(key) ||
    (key.length === 1 && PUNCTUATION.includes(key))
  )
}

interface Parsed {
  modifiers: string[]
  key: string
}

function parse(accelerator: string): Parsed | null {
  const parts = accelerator.split('+').map((part) => part.trim())
  const last = parts.pop()
  if (!last || !isKey(last)) {
    return null
  }
  const modifiers = parts.map((part) => MODIFIERS[part.toLowerCase()])
  if (modifiers.some((modifier) => modifier === undefined)) {
    return null
  }
  const unique = [...new Set(modifiers as string[])]
  if (unique.length !== modifiers.length) {
    return null
  }
  const key = last.toLowerCase()
  return { modifiers: unique.sort(), key: KEY_ALIASES[key] ?? key }
}

// A key the menu can bind. Without a modifier only function keys count, so typing never
// triggers a command.
export function isAccelerator(text: string): boolean {
  const parsed = parse(text)
  return parsed !== null && (parsed.modifiers.length > 0 || FUNCTION_KEY.test(parsed.key))
}

// One spelling per shortcut, so `Ctrl+Shift+F` and `shift+control+f` compare equal. Off macOS,
// Ctrl and CmdOrCtrl are the same key.
export function normalizeAccelerator(text: string, platform: string): string | null {
  const parsed = parse(text)
  if (!parsed) {
    return null
  }
  const modifiers =
    platform === 'darwin'
      ? parsed.modifiers
      : [...new Set(parsed.modifiers.map((m) => (m === 'cmdorctrl' ? 'ctrl' : m)))].sort()
  return [...modifiers, parsed.key].join('+')
}

// Punctuation by `KeyboardEvent.keyCode`. Electron turns these accelerator characters into the
// same key codes when it matches a shortcut, so a recorded key fires on the key that was pressed.
const OEM_KEYS: Readonly<Record<number, string>> = {
  186: ';',
  187: '=',
  188: ',',
  189: '-',
  190: '.',
  191: '/',
  192: '`',
  219: '[',
  220: '\\',
  221: ']',
  222: "'",
}

// Letters, digits and punctuation follow the keyboard layout, as the menu does: Ctrl+Z on a
// Swiss or German keyboard is Ctrl+Z, though the key sits where US keyboards have Y. The key
// code ignores Shift, so Shift+1 stays `Shift+1`.
function layoutKey(keyCode: number): string | null {
  if ((keyCode >= 65 && keyCode <= 90) || (keyCode >= 48 && keyCode <= 57)) {
    return String.fromCharCode(keyCode)
  }
  return OEM_KEYS[keyCode] ?? null
}

// The keys that are the same on every layout, by `KeyboardEvent.code`.
const CODE_KEYS: Readonly<Record<string, string>> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
}

function codeKey(code: string): string | null {
  const match = /^(?:(F[0-9]{1,2})|Numpad([0-9]))$/.exec(code)
  if (match) {
    const [, fn, numpad] = match
    return fn ?? `num${numpad}`
  }
  return CODE_KEYS[code] ?? null
}

export interface KeyPress {
  code: string
  keyCode: number
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

// The accelerator of a key press, or null for a lone modifier or a key the menu cannot bind.
// Ctrl on Linux and Windows and Cmd on macOS become `CmdOrCtrl`, as the defaults are written.
export function acceleratorOf(press: KeyPress, platform: string): string | null {
  const key = codeKey(press.code) ?? layoutKey(press.keyCode)
  if (!key) {
    return null
  }
  const isMac = platform === 'darwin'
  const modifiers = [
    (isMac ? press.metaKey : press.ctrlKey) && 'CmdOrCtrl',
    isMac && press.ctrlKey && 'Ctrl',
    press.altKey && 'Alt',
    press.shiftKey && 'Shift',
    !isMac && press.metaKey && 'Super',
  ].filter((modifier): modifier is string => typeof modifier === 'string')
  const accelerator = [...modifiers, key].join('+')
  return isAccelerator(accelerator) ? accelerator : null
}

const MAC_ORDER = ['ctrl', 'alt', 'altgr', 'shift', 'cmdorctrl', 'super']
const MAC_SYMBOLS: Readonly<Record<string, string>> = {
  cmdorctrl: '⌘',
  ctrl: '⌃',
  alt: '⌥',
  altgr: '⌥',
  shift: '⇧',
  super: '⌘',
}

const ORDER = ['cmdorctrl', 'ctrl', 'super', 'alt', 'altgr', 'shift']
const NAMES: Readonly<Record<string, string>> = {
  cmdorctrl: 'Ctrl',
  ctrl: 'Ctrl',
  alt: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  super: 'Super',
}

const KEY_LABELS: Readonly<Record<string, string>> = {
  plus: '+',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  capslock: 'CapsLock',
  numlock: 'NumLock',
  scrolllock: 'ScrollLock',
  printscreen: 'PrintScreen',
  escape: 'Esc',
  numdec: 'Num .',
  numadd: 'Num +',
  numsub: 'Num -',
  nummult: 'Num *',
  numdiv: 'Num /',
}

function keyLabel(key: string): string {
  const label = KEY_LABELS[key]
  if (label) {
    return label
  }
  if (/^num[0-9]$/.test(key)) {
    return `Num ${key.slice(3)}`
  }
  return key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1)
}

// The shortcut as the platform writes it: `Ctrl+Shift+F`, or `⇧⌘F` on macOS.
export function formatAccelerator(text: string, platform: string): string {
  const parsed = parse(text)
  if (!parsed) {
    return text
  }
  const key = keyLabel(parsed.key)
  const isMac = platform === 'darwin'
  const order = isMac ? MAC_ORDER : ORDER
  const modifiers = [
    ...new Set(
      [...parsed.modifiers]
        .sort((a, b) => order.indexOf(a) - order.indexOf(b))
        .map((m) => (isMac ? MAC_SYMBOLS[m] : NAMES[m])),
    ),
  ]
  return isMac ? `${modifiers.join('')}${key}` : [...modifiers, key].join('+')
}
