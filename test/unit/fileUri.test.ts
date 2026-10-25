import { describe, expect, test } from 'vitest'
import { fileDragTransfer, fileUri, parseFileDrag } from '../../shared/fileUri'

describe('fileUri', () => {
  test('encodes a posix path', () => {
    expect(fileUri('/home/sam/repo', 'src/a b.ts')).toBe('file:///home/sam/repo/src/a%20b.ts')
  })

  test('encodes reserved characters and non-ascii', () => {
    expect(fileUri('/tmp', 'a#b?.ts')).toBe('file:///tmp/a%23b%3F.ts')
    expect(fileUri('/tmp', 'ünicode.ts')).toBe('file:///tmp/%C3%BCnicode.ts')
  })

  test('builds a windows file uri with a drive letter', () => {
    expect(fileUri('C:\\repo', 'src/a b.ts')).toBe('file:///C:/repo/src/a%20b.ts')
    expect(fileUri('C:/repo/', 'src/a.ts')).toBe('file:///C:/repo/src/a.ts')
  })

  test('builds a UNC file uri', () => {
    expect(fileUri('\\\\server\\share', 'dir/a b.txt')).toBe('file://server/share/dir/a%20b.txt')
  })

  test('does not duplicate a trailing separator', () => {
    expect(fileUri('/home/sam/repo/', 'a.ts')).toBe('file:///home/sam/repo/a.ts')
  })
})

describe('fileDragTransfer', () => {
  const commit = { commitId: 'abc', isImmutable: false }
  const file = { path: 'src/a b.ts', status: 'modified' as const }

  test('puts the file uri on the drag for a file that exists', () => {
    const drag = fileDragTransfer('/home/sam/repo', commit, file)
    expect(drag.uriList).toBe('file:///home/sam/repo/src/a%20b.ts')
    expect(drag.resourceUrls).toBe('["file:///home/sam/repo/src/a%20b.ts"]')
    expect(drag.locked).toBe(false)
    expect(parseFileDrag(drag.payload)).toEqual({
      commitId: 'abc',
      path: 'src/a b.ts',
      isImmutable: false,
    })
  })

  test('omits the uri for a deleted file and locks an immutable commit', () => {
    const drag = fileDragTransfer(
      '/home/sam/repo',
      { commitId: 'abc', isImmutable: true },
      { path: 'gone.ts', status: 'removed' },
    )
    expect(drag.uriList).toBeUndefined()
    expect(drag.resourceUrls).toBeUndefined()
    expect(drag.locked).toBe(true)
    expect(parseFileDrag(drag.payload)?.isImmutable).toBe(true)
  })

  test('rejects a payload that is not a file drag', () => {
    expect(parseFileDrag('')).toBeNull()
    expect(parseFileDrag('{"path":"a.ts"}')).toBeNull()
  })
})
