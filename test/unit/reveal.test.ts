import { expect, test } from 'vitest'
import { revealStep } from '../../webview/src/graph/reveal'

const asked = { id: 'graph when asked' }
const newer = { id: 'next graph' }

test('scrolls once the row is there', () => {
  expect(revealStep({ commitId: 'c1', shownIn: asked }, asked, true)).toBe('scroll')
  expect(revealStep({ commitId: 'c1', shownIn: asked }, newer, true)).toBe('scroll')
})

test('waits for a newer graph while the shown one lacks the row', () => {
  expect(revealStep({ commitId: 'c1', shownIn: asked }, asked, false)).toBe('wait')
})

test('gives up when a newer graph lacks the row too', () => {
  expect(revealStep({ commitId: 'c1', shownIn: asked }, newer, false)).toBe('drop')
})
