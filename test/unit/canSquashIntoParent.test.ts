import { describe, expect, test } from 'vitest'
import { canSquashIntoParent } from '../../webview/src/graph/canSquashIntoParent'

const mutable = { isImmutable: false, isWorkingCopy: false, isEmpty: false }
const immutable = { isImmutable: true, isWorkingCopy: false, isEmpty: false }

describe('canSquashIntoParent', () => {
  test('allows a mutable change with one mutable parent', () => {
    const commits = new Map([['parent', mutable]])
    expect(canSquashIntoParent({ ...mutable, parents: ['parent'] }, commits)).toBe(true)
  })

  test('allows a change whose parent is not loaded', () => {
    expect(canSquashIntoParent({ ...mutable, parents: ['parent'] }, new Map())).toBe(true)
  })

  test('omits an immutable change', () => {
    const commits = new Map([['parent', mutable]])
    expect(canSquashIntoParent({ ...immutable, parents: ['parent'] }, commits)).toBe(false)
  })

  test('omits a merge', () => {
    expect(canSquashIntoParent({ ...mutable, parents: ['left', 'right'] }, new Map())).toBe(false)
  })

  test('omits a change with an immutable parent', () => {
    const commits = new Map([['parent', immutable]])
    expect(canSquashIntoParent({ ...mutable, parents: ['parent'] }, commits)).toBe(false)
  })

  test('omits an empty working copy', () => {
    const commits = new Map([['parent', mutable]])
    const workingCopy = { ...mutable, isWorkingCopy: true, isEmpty: true, parents: ['parent'] }
    expect(canSquashIntoParent(workingCopy, commits)).toBe(false)
  })

  test('allows an empty change that is not the working copy', () => {
    const commits = new Map([['parent', mutable]])
    expect(canSquashIntoParent({ ...mutable, isEmpty: true, parents: ['parent'] }, commits)).toBe(
      true,
    )
  })
})
