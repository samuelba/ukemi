import { changedPathsInDirectory } from '../../../shared/fileTree'
import type { ChangedFile } from '../../../shared/model'
import { confirm } from '../ui'
import {
  contextCommit,
  parseContext,
  shortId,
  type CommandEnv,
  type Handler,
  type Target,
} from './context'

interface FileTarget extends Target {
  file: ChangedFile
}

async function changedFiles(target: Target): Promise<ChangedFile[]> {
  if (target.commit.isWorkingCopy) {
    return target.model.graph?.workingCopyFiles ?? []
  }
  return target.model.filesFor(target.commit.commitId)
}

export async function fileTarget(env: CommandEnv, arg: unknown): Promise<FileTarget | null> {
  const ctx = parseContext(arg)
  const target = contextCommit(env, arg)
  if (!target || !ctx.path) {
    return null
  }
  const files = await changedFiles(target)
  const file = files.find((f) => f.path === ctx.path) ?? {
    path: ctx.path,
    sourcePath: ctx.path,
    status: 'modified' as const,
    isConflicted: false,
  }
  return { ...target, file }
}

function withFile(env: CommandEnv, fn: (target: FileTarget) => Promise<unknown>): Handler {
  return async (arg?: unknown) => {
    const target = await fileTarget(env, arg)
    if (target) {
      await fn(target)
    }
  }
}

async function discard(env: CommandEnv, { model, commit, file }: FileTarget): Promise<void> {
  if (commit.isImmutable) {
    return
  }
  if (await confirm(env.ui, `Discard changes to ${file.path} in ${shortId(commit)}?`, 'Discard')) {
    await env.operations.run('Discard', model, () =>
      model.repo.restoreFiles(commit.commitId, [file.path]),
    )
  }
}

// Takes one side of every conflict in the file. jj only does this for 2-sided conflicts.
async function takeSide(
  env: CommandEnv,
  { model, commit, file }: FileTarget,
  tool: ':ours' | ':theirs',
): Promise<void> {
  if (commit.isImmutable) {
    void env.ui.warn(`Ukemi: ${shortId(commit)} is immutable.`)
    return
  }
  await env.operations.run('Resolve', model, () =>
    model.repo.resolveWithBuiltin(commit.commitId, file.path, tool),
  )
}

// Opens the change's first conflicted file in the resolver.
async function resolveChange(env: CommandEnv, arg: unknown): Promise<void> {
  const target = contextCommit(env, arg)
  if (!target) {
    return
  }
  const [first] = (await changedFiles(target)).filter((file) => file.isConflicted)
  if (!first) {
    void env.ui.info(`Ukemi: ${shortId(target.commit)} has no conflicts.`)
    return
  }
  await env.workbench.openEditor(target.model, target.commit, first.path)
}

async function discardDirectory(env: CommandEnv, arg: unknown): Promise<void> {
  const ctx = parseContext(arg)
  const target = contextCommit(env, arg)
  if (!target || !ctx.path || target.commit.isImmutable) {
    return
  }
  const paths = changedPathsInDirectory(await changedFiles(target), ctx.path)
  if (paths.length === 0) {
    void env.ui.warn('Ukemi: no changes in that folder.')
    return
  }
  const count = paths.length === 1 ? '1 file' : `${paths.length} files`
  if (await confirm(env.ui, `Discard changes in ${ctx.path} (${count})?`, 'Discard')) {
    await env.operations.run('Discard', target.model, () =>
      target.model.repo.restoreFiles(target.commit.commitId, paths),
    )
  }
}

export function fileCommands(env: CommandEnv): Record<string, Handler> {
  return {
    'ukemi.file.open': withFile(env, ({ model, commit, file }) =>
      env.workbench.openFileAtRevision(model, commit, file.path),
    ),
    'ukemi.file.edit': withFile(env, ({ model, commit, file }) =>
      env.workbench.openEditor(model, commit, file.path),
    ),
    'ukemi.conflict.resolve': (arg) => resolveChange(env, arg),
    'ukemi.conflict.takeSide1': withFile(env, (target) => takeSide(env, target, ':ours')),
    'ukemi.conflict.takeSide2': withFile(env, (target) => takeSide(env, target, ':theirs')),
    'ukemi.file.openDiff': withFile(env, ({ model, commit, file }) =>
      env.workbench.openFileDiff(model, commit, file),
    ),
    'ukemi.file.splitAbove': withFile(env, ({ model, commit, file }) =>
      env.operations.run('Split', model, () =>
        model.repo.splitFiles(commit.commitId, [file.path], 'above'),
      ),
    ),
    'ukemi.file.splitBelow': withFile(env, ({ model, commit, file }) =>
      env.operations.run('Split', model, () =>
        model.repo.splitFiles(commit.commitId, [file.path], 'below'),
      ),
    ),
    'ukemi.file.discard': withFile(env, (target) => discard(env, target)),
    'ukemi.file.discardDirectory': (arg) => discardDirectory(env, arg),
    'ukemi.file.copyPath': withFile(env, async ({ file }) => env.ui.copy(file.path)),
  }
}
