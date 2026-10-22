const UNDO = /^undo: /
const REDO = /^redo: /

export const UNDO_HISTORY_LIMIT = 50

export function canRedo(descriptions: readonly string[]): boolean {
  let balance = 0
  for (const description of descriptions) {
    if (UNDO.test(description)) {
      balance += 1
    } else if (REDO.test(description)) {
      balance -= 1
    } else {
      break
    }
  }
  return balance > 0
}
