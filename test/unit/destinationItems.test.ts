import { describe, expect, test } from 'vitest'
import { destinationItems } from '../../src/app/commands/commitCommands'

describe('destinationItems', () => {
  test('lists trunk, local bookmarks, and remote bookmarks', () => {
    expect(
      destinationItems([
        {
          localBookmarks: [{ name: 'main' }, { name: 'feature' }],
          remoteBookmarks: [{ name: 'main', remote: 'origin' }],
        },
        {
          localBookmarks: [{ name: 'feature' }],
          remoteBookmarks: [
            { name: 'main', remote: 'origin' },
            { name: 'topic', remote: 'upstream' },
          ],
        },
      ]).map((item) => item.label),
    ).toEqual(['trunk()', 'main', 'feature', 'main@origin', 'topic@upstream'])
  })

  test('quotes bookmark names that jj would read as an expression', () => {
    expect(
      destinationItems([
        {
          localBookmarks: [{ name: 'ok|main' }],
          remoteBookmarks: [{ name: 'rel-', remote: 'origin' }],
        },
      ]).map((item) => item.label),
    ).toEqual(['trunk()', '"ok|main"', '"rel-"@origin'])
  })
})
