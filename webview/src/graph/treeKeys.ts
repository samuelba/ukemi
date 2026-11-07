export type TreeAction =
  | 'next'
  | 'prev'
  | 'first'
  | 'last'
  | 'pageDown'
  | 'pageUp'
  | 'expand'
  | 'collapse'
  | 'activate'
  | 'open'
  | 'menu'

export type MoveAction = Extract<
  TreeAction,
  'next' | 'prev' | 'first' | 'last' | 'pageDown' | 'pageUp'
>

export interface TreeKey {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

const PLAIN_KEYS: Readonly<Record<string, TreeAction>> = {
  ArrowDown: 'next',
  j: 'next',
  ArrowUp: 'prev',
  k: 'prev',
  Home: 'first',
  End: 'last',
  PageDown: 'pageDown',
  PageUp: 'pageUp',
  ArrowRight: 'expand',
  ArrowLeft: 'collapse',
  Enter: 'activate',
  ' ': 'activate',
  ContextMenu: 'menu',
}

const SHIFT_KEYS: Readonly<Record<string, TreeAction>> = {
  Enter: 'open',
  F10: 'menu',
  ContextMenu: 'menu',
}

// What a key does in the graph tree. Keys with Ctrl, Meta or Alt belong to the app (Ctrl+F
// searches the graph, the desktop's Ctrl+Z undoes), so the tree leaves them alone.
export function treeKeyAction(event: TreeKey): TreeAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return null
  }
  const table = event.shiftKey ? SHIFT_KEYS : PLAIN_KEYS
  return Object.hasOwn(table, event.key) ? (table[event.key] ?? null) : null
}

export function isMove(action: TreeAction): action is MoveAction {
  return ['next', 'prev', 'first', 'last', 'pageDown', 'pageUp'].includes(action)
}

// The row a move lands on, clamped to the ends. `index` is -1 when no row has focus.
export function stepIndex(action: MoveAction, index: number, count: number, pageSize: number) {
  if (count === 0) {
    return -1
  }
  const page = Math.max(1, pageSize)
  const target = {
    next: index + 1,
    prev: index - 1,
    first: 0,
    last: count - 1,
    pageDown: index + page,
    pageUp: index - page,
  }[action]
  return Math.min(count - 1, Math.max(0, target))
}
