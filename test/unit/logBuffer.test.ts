import { expect, test, vi } from 'vitest'
import { LogBuffer } from '../../src/desktop/logBuffer'

test('writes through, keeps the newest lines and reports each one', () => {
  const target = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const buffer = new LogBuffer(target, 2)
  const seen: string[] = []
  buffer.onLine((line) => seen.push(`${line.level}:${line.message}`))
  buffer.info('a')
  buffer.warn('b')
  buffer.error('c')
  expect(target.warn).toHaveBeenCalledWith('b')
  expect(buffer.recent().map((line) => line.message)).toEqual(['b', 'c'])
  expect(seen).toEqual(['info:a', 'warning:b', 'error:c'])
  buffer.clear()
  expect(buffer.recent()).toEqual([])
})
