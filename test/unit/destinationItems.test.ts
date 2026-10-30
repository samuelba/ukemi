import { describe, expect, test } from 'vitest'
import { destinationItems } from '../../src/vscode/commands/commitCommands'

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
})
