import { describe, expect, test } from 'vitest'
import { parseElidedHeads } from '../../src/jj/parse'
import { JjRunner } from '../../src/jj/runner'
import { elidedHeadsTemplate } from '../../src/jj/templates'
import { NULL_LOGGER } from '../../src/util/logger'
import { JJ_BINARY } from '../helpers/jjFixture'

const P = 'a'.repeat(40)
const Q = 'b'.repeat(40)
const X = 'c'.repeat(40)
const Y = 'd'.repeat(40)

describe('elidedHeadsTemplate', () => {
  test('evaluates the lookup of each parent inside the template', () => {
    expect(elidedHeadsTemplate('x | y')).toBe(
      'commit_id ++ " " ++ revset("heads(::" ++ commit_id ++ " & (x | y))")' +
        '.map(|c| c.commit_id()).join(" ") ++ "\\n"',
    )
  })

  test('quotes a target that holds quotes', () => {
    expect(elidedHeadsTemplate('description("a")')).toContain(' & (description(\\"a\\")))")')
  })
})

describe('parseElidedHeads', () => {
  test('keeps the order of each parent ids, and parents that found nothing', () => {
    const heads = parseElidedHeads(`${P} ${Y} ${X}\n${Q} \n`)
    expect([...heads]).toEqual([
      [P, [Y, X]],
      [Q, []],
    ])
  })

  test('skips lines that do not start with a commit id', () => {
    expect(parseElidedHeads('Warning: something\n\n').size).toBe(0)
  })
})

describe('JjRunner.version', () => {
  test('asks the binary, also by command name, and asks again after a switch', async () => {
    const runner = new JjRunner(JJ_BINARY, NULL_LOGGER)
    const first = runner.version()
    expect(runner.version()).toBe(first)
    expect((await first)?.major).toBe(0)

    runner.useBinary('/nonexistent/jj')
    expect(await runner.version()).toBeNull()
  })
})
