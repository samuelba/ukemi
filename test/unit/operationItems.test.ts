import { describe, expect, test } from 'vitest'
import type { Operation } from '../../shared/model'
import { isOperationNode, operationNodes } from '../../src/repo/operationItems'

const NOW = Date.parse('2026-10-24T12:00:00Z')

function operation(id: string, description: string, time: string): Operation {
  return { id, description, user: 'sam@host', time }
}

describe('operationNodes', () => {
  const nodes = operationNodes(
    '/repo',
    [
      operation('aaaa', 'describe commit 123\nargs: jj describe', '2026-10-24T11:59:30Z'),
      operation('bbbb', 'new empty commit', '2026-10-24T09:00:00Z'),
      operation('cccc', '', '2026-10-20T09:00:00Z'),
    ],
    NOW,
  )

  test('marks only the newest operation as current', () => {
    expect(nodes.map((node) => node.contextValue)).toEqual([
      'operation+current',
      'operation',
      'operation',
    ])
    expect(nodes[0]?.description).toBe('current · now')
    expect(nodes[1]?.description).toBe('3h')
  })

  test('labels rows with the first line of the description', () => {
    expect(nodes.map((node) => node.label)).toEqual([
      'describe commit 123',
      'new empty commit',
      '(no description)',
    ])
  })

  test('keeps the full description, id and user in the tooltip', () => {
    expect(nodes[0]?.tooltip).toContain('args: jj describe')
    expect(nodes[0]?.tooltip).toContain('aaaa by sam@host')
  })

  test('rows are recognised as command arguments', () => {
    expect(nodes.every(isOperationNode)).toBe(true)
    expect(isOperationNode({ kind: 'operation', repoId: '/repo' })).toBe(false)
    expect(isOperationNode(null)).toBe(false)
  })
})
