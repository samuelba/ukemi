import { title } from '../../../shared/format'
import { isOperationNode, type OperationNode } from '../../repo/operationItems'
import { confirm } from '../ui'
import { contextModel, type CommandEnv, type Handler } from './context'

export function operationCommands(env: CommandEnv): Record<string, Handler> {
  return {
    'ukemi.operation.restore': (arg) => restore(env, arg),
    'ukemi.operation.revert': (arg) => revert(env, arg),
    'ukemi.operation.copyId': async (arg) => {
      if (isOperationNode(arg)) {
        await env.ui.copy(arg.operationId)
      }
    },
  }
}

async function restore(env: CommandEnv, arg: unknown): Promise<void> {
  const target = await earlierOperation(env, arg)
  if (!target) {
    return
  }
  const { model, node } = target
  const accepted = await confirm(
    env.ui,
    `Restore the repository to how it was after “${node.label}”?`,
    'Restore',
    'Every later operation is undone, as a new operation. You can undo this.',
  )
  if (accepted) {
    await env.operations.run('Restore operation', model, () =>
      model.repo.restoreOperation(node.operationId),
    )
  }
}

async function revert(env: CommandEnv, arg: unknown): Promise<void> {
  const target = await earlierOperation(env, arg)
  if (!target) {
    return
  }
  const { model, node } = target
  const accepted = await confirm(
    env.ui,
    `Revert “${node.label}”?`,
    'Revert',
    'Only this operation is undone. Later operations stay. You can undo this.',
  )
  if (accepted) {
    await env.operations.run('Revert operation', model, () =>
      model.repo.revertOperation(node.operationId),
    )
  }
}

// The row's repository, when the operation is still in its log and is not the current one.
async function earlierOperation(env: CommandEnv, arg: unknown) {
  if (!isOperationNode(arg)) {
    return null
  }
  const model = contextModel(env, { repoId: arg.repoId })
  if (!model) {
    return null
  }
  await model.settled()
  const index = model.operations.findIndex((operation) => operation.id === arg.operationId)
  if (index === 0) {
    void env.ui.info('Ukemi: this is the current operation already.')
    return null
  }
  if (index < 0) {
    void env.ui.warn('Ukemi: that operation is no longer in the shown log. Refresh and try again.')
    return null
  }
  const operation = model.operations[index]
  const node: OperationNode = {
    ...arg,
    label: title(operation?.description ?? '') || arg.label,
  }
  return { model, node }
}
