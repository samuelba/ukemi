import { relativeTime, title } from '../../shared/format'
import type { Operation } from '../../shared/model'

export interface OperationNode {
  kind: 'operation'
  repoId: string
  operationId: string
  label: string
  description: string
  tooltip: string
  contextValue: string
  id: string
}

const SHORT_ID_LENGTH = 12

// The operation log of a repository, newest first. The newest operation is the current state, so
// restoring or reverting it would do nothing useful.
export function operationNodes(
  repoId: string,
  operations: readonly Operation[],
  now: number,
): OperationNode[] {
  return operations.map((operation, index) => {
    const isCurrent = index === 0
    const shortId = operation.id.slice(0, SHORT_ID_LENGTH)
    return {
      kind: 'operation',
      repoId,
      operationId: operation.id,
      label: title(operation.description) || '(no description)',
      description: [isCurrent ? 'current' : '', relativeTime(operation.time, now)]
        .filter((part) => part.length > 0)
        .join(' · '),
      tooltip: [operation.description, '', `${shortId} by ${operation.user}`, operation.time].join(
        '\n',
      ),
      contextValue: isCurrent ? 'operation+current' : 'operation',
      id: `${repoId}\n${operation.id}`,
    }
  })
}

export function isOperationNode(arg: unknown): arg is OperationNode {
  if (typeof arg !== 'object' || arg === null) {
    return false
  }
  const value = arg as { kind?: unknown; repoId?: unknown; operationId?: unknown }
  return (
    value.kind === 'operation' &&
    typeof value.repoId === 'string' &&
    typeof value.operationId === 'string'
  )
}
