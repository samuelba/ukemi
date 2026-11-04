import { describe, expect, test } from 'vitest'
import { BINARY_PLACEHOLDER } from '../../src/app/revisionContent'
import { imageMime, MAX_DIFF_BYTES, sideFromBytes } from '../../src/desktop/workbench'

describe('imageMime', () => {
  test('knows raster images by extension, in any case', () => {
    expect(imageMime('icons/logo.PNG')).toBe('image/png')
    expect(imageMime('a.jpeg')).toBe('image/jpeg')
    expect(imageMime('favicon.ico')).toBe('image/x-icon')
  })

  test('leaves SVG and other files to the text diff', () => {
    expect(imageMime('logo.svg')).toBeUndefined()
    expect(imageMime('Makefile')).toBeUndefined()
    expect(imageMime('dir.png/readme')).toBeUndefined()
  })
})

describe('sideFromBytes', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])

  test('sends an image as a data URL', () => {
    expect(sideFromBytes('a.png', png)).toEqual({
      text: BINARY_PLACEHOLDER,
      isBinary: true,
      image: `data:image/png;base64,${png.toString('base64')}`,
    })
  })

  test('shows a Git LFS pointer and a missing image as text', () => {
    const pointer = 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\n'
    expect(sideFromBytes('a.png', Buffer.from(pointer))).toEqual({ text: pointer, isBinary: false })
    expect(sideFromBytes('a.png', Buffer.alloc(0))).toEqual({ text: '', isBinary: false })
  })

  test('leaves out an image that is too large', () => {
    const side = sideFromBytes('a.png', Buffer.alloc(MAX_DIFF_BYTES + 1, 1))
    expect([side.isBinary, side.image]).toEqual([true, undefined])
  })

  test('keeps other binary files as a placeholder', () => {
    expect(sideFromBytes('a.bin', png)).toEqual({ text: BINARY_PLACEHOLDER, isBinary: true })
  })
})
