import { describe, expect, test } from 'vitest'
import { fetchDelay, parseDuration } from '../../src/util/duration'

describe('parseDuration', () => {
  test('reads a number and a unit', () => {
    expect(parseDuration('45s')).toBe(45_000)
    expect(parseDuration('10m')).toBe(600_000)
    expect(parseDuration('1.5h')).toBe(5_400_000)
    expect(parseDuration('2d')).toBe(172_800_000)
  })

  test('allows the every prefix, spaces and any case', () => {
    expect(parseDuration('every 10m')).toBe(600_000)
    expect(parseDuration('  every   1.5h  ')).toBe(5_400_000)
    expect(parseDuration('10 S')).toBe(10_000)
  })

  test('allows a decimal without a leading zero', () => {
    expect(parseDuration('.5h')).toBe(1_800_000)
  })

  test('rejects values below 10 seconds', () => {
    expect(parseDuration('9s')).toBeNull()
    expect(parseDuration('0.1m')).toBeNull()
    expect(parseDuration('10s')).toBe(10_000)
  })

  test('rejects values that are not a duration', () => {
    expect(parseDuration('')).toBeNull()
    expect(parseDuration('10')).toBeNull()
    expect(parseDuration('10x')).toBeNull()
    expect(parseDuration('every')).toBeNull()
    expect(parseDuration('-5m')).toBeNull()
    expect(parseDuration('0s')).toBeNull()
  })
})

describe('fetchDelay', () => {
  test('is due when the repository has never been fetched', () => {
    expect(fetchDelay(undefined, 1_000, 600_000)).toBe(0)
  })

  test('is due when the last fetch is older than the interval', () => {
    expect(fetchDelay(1_000, 601_000, 600_000)).toBe(0)
    expect(fetchDelay(1_000, 700_000, 600_000)).toBe(0)
  })

  test('returns the remaining time when the last fetch is still fresh', () => {
    expect(fetchDelay(1_000, 1_000, 600_000)).toBe(600_000)
    expect(fetchDelay(1_000, 61_000, 600_000)).toBe(540_000)
  })
})
