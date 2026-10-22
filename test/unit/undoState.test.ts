import { describe, expect, test } from 'vitest'
import { canRedo } from '../../src/repo/undoState'

const undo = 'undo: restore to operation 8f2c'
const redo = 'redo: restore to operation 21d9'
const describeOp = 'describe commit feddcf9b'

describe('canRedo', () => {
  test.each([
    ['no operations', [], false],
    ['a normal operation on top', [describeOp, undo], false],
    ['one undo', [undo, describeOp], true],
    ['two undos and one redo', [redo, undo, undo, describeOp], true],
    ['as many redos as undos', [redo, redo, undo, undo, describeOp], false],
    ['an undo after a redo', [undo, redo, undo, describeOp], true],
  ])('%s', (_name, descriptions, expected) => {
    expect(canRedo(descriptions)).toBe(expected)
  })
})
