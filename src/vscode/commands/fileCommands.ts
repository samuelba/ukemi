import { relative, sep } from 'node:path'
import * as vscode from 'vscode'
import type { ChangedFile } from '../../../shared/model'
import type { RepoModel } from '../../repo/repoModel'
import { openFileAtRevision, openFileDiff } from '../diff'
import {
  confirm,
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

async function fileTarget(env: CommandEnv, arg: unknown): Promise<FileTarget | null> {
  const ctx = parseContext(arg)
  const target = contextCommit(env, arg)
  if (!target || !ctx.path) {
    return null
  }
  const files = target.commit.isWorkingCopy
    ? (target.model.graph?.workingCopyFiles ?? [])
    : await target.model.filesFor(target.commit.commitId)
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
  if (await confirm(`Discard changes to ${file.path} in ${shortId(commit)}?`, 'Discard')) {
    await env.operations.run('Discard', model, () =>
      model.repo.restoreFiles(commit.commitId, [file.path]),
    )
  }
}

function editorTarget(
  env: CommandEnv,
  uri?: vscode.Uri,
): { model: RepoModel; path: string } | null {
  const fileUri = uri ?? vscode.window.activeTextEditor?.document.uri
  if (!fileUri || fileUri.scheme !== 'file') {
    return null
  }
  const model = env.registry.models
    .filter((m) => fileUri.fsPath.startsWith(m.root + sep))
    .sort((a, b) => b.root.length - a.root.length)[0]
  if (!model) {
    return null
  }
  return { model, path: relative(model.root, fileUri.fsPath).split(sep).join('/') }
}

function workingCopyContext(model: RepoModel, path: string) {
  const commit = model.graph?.commits.find((c) => c.isWorkingCopy)
  return commit ? { repoId: model.root, commitId: commit.commitId, path } : null
}

function scmContext(env: CommandEnv, arg: unknown) {
  const ctx = parseContext(arg)
  const root =
    typeof (arg as { root?: unknown })?.root === 'string'
      ? (arg as { root: string }).root
      : ctx.repoId
  const model = root ? env.registry.modelFor(root) : null
  return model && ctx.path ? workingCopyContext(model, ctx.path) : null
}

export function fileCommands(env: CommandEnv): Record<string, Handler> {
  return {
    'ukemi.file.open': withFile(env, ({ model, commit, file }) =>
      openFileAtRevision(model, commit, file.path),
    ),
    'ukemi.file.openDiff': withFile(env, ({ model, commit, file }) =>
      openFileDiff(model, commit, file),
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
    'ukemi.file.copyPath': withFile(env, async ({ file }) =>
      vscode.env.clipboard.writeText(file.path),
    ),
    'ukemi.scm.openDiff': async (arg?: unknown) => {
      const ctx = scmContext(env, arg)
      if (ctx) {
        await vscode.commands.executeCommand('ukemi.file.openDiff', ctx)
      }
    },
    'ukemi.scm.discard': async (arg?: unknown) => {
      const ctx = scmContext(env, arg)
      if (ctx) {
        await vscode.commands.executeCommand('ukemi.file.discard', ctx)
      }
    },
    'ukemi.openFileDiff': async (uri?: unknown) => {
      const target = editorTarget(env, uri instanceof vscode.Uri ? uri : undefined)
      const ctx = target ? workingCopyContext(target.model, target.path) : null
      if (ctx) {
        await vscode.commands.executeCommand('ukemi.file.openDiff', ctx)
      }
    },
    'ukemi.revertFile': async (uri?: unknown) => {
      const target = editorTarget(env, uri instanceof vscode.Uri ? uri : undefined)
      const ctx = target ? workingCopyContext(target.model, target.path) : null
      if (ctx) {
        await vscode.commands.executeCommand('ukemi.file.discard', ctx)
      }
    },
  }
}
