import { describe, expect, test } from 'vitest'
import { isMove, stepIndex, treeKeyAction, type TreeKey } from '../../webview/src/graph/treeKeys'

const key = (name: string, modifiers: Partial<TreeKey> = {}): TreeKey => ({
  key: name,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...modifiers,
})

describe('treeKeyAction', () => {
  test.each([
    ['ArrowDown', 'next'],
    ['j', 'next'],
    ['ArrowUp', 'prev'],
    ['k', 'prev'],
    ['Home', 'first'],
    ['End', 'last'],
    ['PageDown', 'pageDown'],
    ['PageUp', 'pageUp'],
    ['ArrowRight', 'expand'],
    ['ArrowLeft', 'collapse'],
    ['Enter', 'activate'],
    [' ', 'activate'],
    ['ContextMenu', 'menu'],
  ])('%j is %s', (name, action) => {
    expect(treeKeyAction(key(name))).toBe(action)
  })

  test('Shift+Enter opens and Shift+F10 shows the menu', () => {
    expect(treeKeyAction(key('Enter', { shiftKey: true }))).toBe('open')
    expect(treeKeyAction(key('F10', { shiftKey: true }))).toBe('menu')
    expect(treeKeyAction(key('ContextMenu', { shiftKey: true }))).toBe('menu')
  })

  test('F10 alone, J and other keys do nothing', () => {
    expect(treeKeyAction(key('F10'))).toBeNull()
    expect(treeKeyAction(key('J', { shiftKey: true }))).toBeNull()
    expect(treeKeyAction(key('x'))).toBeNull()
    expect(treeKeyAction(key('constructor'))).toBeNull()
  })

  test('leaves keys with Ctrl, Meta or Alt to the app', () => {
    expect(treeKeyAction(key('ArrowDown', { ctrlKey: true }))).toBeNull()
    expect(treeKeyAction(key('j', { metaKey: true }))).toBeNull()
    expect(treeKeyAction(key('Enter', { altKey: true }))).toBeNull()
  })
})

describe('isMove', () => {
  test('tells moves from the other actions', () => {
    expect(isMove('pageUp')).toBe(true)
    expect(isMove('expand')).toBe(false)
    expect(isMove('menu')).toBe(false)
  })
})

describe('stepIndex', () => {
  test('steps and clamps at the ends', () => {
    expect(stepIndex('next', 2, 5, 3)).toBe(3)
    expect(stepIndex('next', 4, 5, 3)).toBe(4)
    expect(stepIndex('prev', 0, 5, 3)).toBe(0)
    expect(stepIndex('first', 3, 5, 3)).toBe(0)
    expect(stepIndex('last', 0, 5, 3)).toBe(4)
  })

  test('pages by the page size, at least one row', () => {
    expect(stepIndex('pageDown', 0, 10, 4)).toBe(4)
    expect(stepIndex('pageDown', 8, 10, 4)).toBe(9)
    expect(stepIndex('pageUp', 5, 10, 4)).toBe(1)
    expect(stepIndex('pageDown', 0, 10, 0)).toBe(1)
  })

  test('starts from the top when no row has focus', () => {
    expect(stepIndex('next', -1, 5, 3)).toBe(0)
    expect(stepIndex('prev', -1, 5, 3)).toBe(0)
  })

  test('has nowhere to go in an empty tree', () => {
    expect(stepIndex('next', -1, 0, 3)).toBe(-1)
  })
})
