import { describe, expect, test, vi } from 'vitest'
import { createDropMarker } from '../../webview/src/graph/dropMarker'

describe('createDropMarker', () => {
  test('shows the marker on one row only', () => {
    const marker = createDropMarker<'insert-above' | 'insert-below'>()
    marker.show('a', 'insert-below')
    marker.show('b', 'insert-above')
    expect(marker.kindFor('a')).toBeNull()
    expect(marker.kindFor('b')).toBe('insert-above')
  })

  test('a row that lost the marker cannot clear it from the new row', () => {
    const marker = createDropMarker<'commit'>()
    marker.show('a', 'commit')
    marker.show('b', 'commit')
    marker.hide('a')
    expect(marker.kindFor('b')).toBe('commit')
    marker.hide('b')
    expect(marker.kindFor('b')).toBeNull()
  })

  test('notifies only when the marker changes', () => {
    const marker = createDropMarker<'commit' | 'file'>()
    const listener = vi.fn()
    const unsubscribe = marker.subscribe(listener)
    marker.show('a', 'commit')
    marker.show('a', 'commit')
    marker.hide('b')
    expect(listener).toHaveBeenCalledTimes(1)
    marker.show('a', 'file')
    marker.clear()
    marker.clear()
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
    marker.show('a', 'commit')
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
