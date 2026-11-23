import { expect, test } from 'vitest'
import { isExpanded, toggleExpansion, type Expansion } from '../../webview/src/graph/expansion'

const initial: Expansion = { expanded: new Set(), isWorkingCopyCollapsed: false }
const a = { changeId: 'a', isWorkingCopy: false }
const b = { changeId: 'b', isWorkingCopy: false }
const asWorkingCopy = (commit: typeof a) => ({ ...commit, isWorkingCopy: true })

test('the working copy starts open and other changes start closed', () => {
  expect(isExpanded(initial, asWorkingCopy(a))).toBe(true)
  expect(isExpanded(initial, a)).toBe(false)
})

test('toggles a change that is not the working copy', () => {
  const opened = toggleExpansion(initial, a)
  expect(isExpanded(opened, a)).toBe(true)
  expect(isExpanded(toggleExpansion(opened, a), a)).toBe(false)
})

test('a change collapsed while it was the working copy stays collapsed after editing another', () => {
  const opened = toggleExpansion(initial, a)
  const collapsed = toggleExpansion(opened, asWorkingCopy(a))
  expect(isExpanded(collapsed, asWorkingCopy(a))).toBe(false)
  expect(isExpanded(collapsed, a)).toBe(false)
})

test('a change expanded while it was the working copy stays expanded after editing another', () => {
  const collapsed = toggleExpansion(initial, asWorkingCopy(a))
  const reopened = toggleExpansion(collapsed, asWorkingCopy(a))
  expect(isExpanded(reopened, a)).toBe(true)
})

test('the working-copy collapse carries over to the next working copy', () => {
  const collapsed = toggleExpansion(initial, asWorkingCopy(a))
  expect(isExpanded(collapsed, asWorkingCopy(b))).toBe(false)
})
