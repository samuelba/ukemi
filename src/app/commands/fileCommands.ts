import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { changedPathsInDirectory } from '../../../shared/fileTree'
import { changeRevision } from '../../jj/revsets'
import { JjError } from '../../jj/runner'
import { appendIgnoreLine, ignoreLine } from '../../util/gitignore'
import type { ChangedFile } from '../../../shared/model'
import { confirm } from '../ui'
import { absorbChanges } from './commitCommands'
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

// A rename touches two paths, and restoring only the new one would leave the old one deleted.
function filePaths(file: ChangedFile): string[] {
  return file.sourcePath === file.path ? [file.path] : [file.sourcePath, file.path]
}

async function discard(env: CommandEnv, { model, commit, file }: FileTarget): Promise<void> {
  if (commit.isImmutable) {
    return
  }
  if (await confirm(env.ui, `Discard changes to ${file.path} in ${shortId(commit)}?`, 'Discard')) {
    await env.operations.run('Discard', model, () =>
      model.repo.restoreFiles(changeRevision(commit), filePaths(file)),
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
    model.repo.resolveWithBuiltin(changeRevision(commit), file.path, tool),
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
      target.model.repo.restoreFiles(changeRevision(target.commit), paths),
    )
  }
}

function chmod(env: CommandEnv, mode: 'x' | 'n'): Handler {
  return withFile(env, async ({ model, commit, file }) => {
    if (commit.isImmutable) {
      void env.ui.warn(`Ukemi: ${shortId(commit)} is immutable.`)
      return
    }
    await env.operations.run('Change mode', model, () =>
      model.repo.chmod(changeRevision(commit), mode, [file.path]),
    )
  })
}

async function readTextOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''
    }
    throw error
  }
}

// jj only untracks ignored files, since it would track any other file again on the next snapshot.
function isNotIgnored(error: unknown): boolean {
  return error instanceof JjError && /is not ignored\./.test(error.stderr)
}

// Stops tracking a working-copy file and keeps it on disk. A file that is not ignored yet is added
// to the workspace's root .gitignore first, after the user agrees.
async function untrack(env: CommandEnv, { model, file }: FileTarget): Promise<void> {
  const needsIgnore = await env.operations.run('Untrack', model, async () => {
    try {
      await model.repo.untrackFiles([file.path])
      return false
    } catch (error: unknown) {
      if (isNotIgnored(error)) {
        return true
      }
      throw error
    }
  })
  if (
    !needsIgnore ||
    !(await confirm(
      env.ui,
      `Add ${ignoreLine(file.path)} to .gitignore and stop tracking it?`,
      'Add to .gitignore',
      'jj only untracks ignored files. The file stays on disk.',
    ))
  ) {
    return
  }
  await env.operations.run('Untrack', model, async () => {
    const gitignore = join(model.root, '.gitignore')
    const content = await readTextOrEmpty(gitignore)
    const updated = appendIgnoreLine(content, file.path)
    if (updated !== content) {
      await writeFile(gitignore, updated)
    }
    await model.repo.untrackFiles([file.path])
  })
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
        model.repo.splitFiles(changeRevision(commit), [file.path], 'above'),
      ),
    ),
    'ukemi.file.splitBelow': withFile(env, ({ model, commit, file }) =>
      env.operations.run('Split', model, () =>
        model.repo.splitFiles(changeRevision(commit), [file.path], 'below'),
      ),
    ),
    'ukemi.file.absorb': withFile(env, ({ model, commit, file }) =>
      absorbChanges(env, model, commit, filePaths(file)),
    ),
    'ukemi.file.makeExecutable': chmod(env, 'x'),
    'ukemi.file.makeNonExecutable': chmod(env, 'n'),
    'ukemi.file.discard': withFile(env, (target) => discard(env, target)),
    'ukemi.file.untrack': withFile(env, async (target) => {
      if (target.commit.isWorkingCopy) {
        await untrack(env, target)
      }
    }),
    'ukemi.file.discardDirectory': (arg) => discardDirectory(env, arg),
    'ukemi.file.copyPath': withFile(env, async ({ file }) => env.ui.copy(file.path)),
  }
}
