import { describe, expect, test } from 'vitest'
import { filePreviewMessage } from '../../webview/src/graph/previewFile'

describe('filePreviewMessage', () => {
  test('a file row opens its diff', () => {
    expect(filePreviewMessage({ previewCommitId: 'abc', previewPath: 'src/a.ts' })).toEqual({
      type: 'openFile',
      commitId: 'abc',
      path: 'src/a.ts',
      mode: 'diff',
    })
  })

  test('a commit or folder row opens nothing', () => {
    expect(filePreviewMessage({ commitId: 'abc' })).toBeNull()
    expect(filePreviewMessage({})).toBeNull()
    expect(filePreviewMessage({ previewCommitId: 'abc' })).toBeNull()
    expect(filePreviewMessage({ previewPath: 'src/a.ts' })).toBeNull()
  })
})
