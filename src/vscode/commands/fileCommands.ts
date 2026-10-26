import { isAbsolute, join, relative, sep } from 'node:path'
import * as vscode from 'vscode'
import { changedPathsInDirectory } from '../../../shared/fileTree'
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

async function changedFiles(target: Target): Promise<ChangedFile[]> {
  if (target.commit.isWorkingCopy) {
    return target.model.graph?.workingCopyFiles ?? []
  }
  return target.model.filesFor(target.commit.commitId)
}

async function fileTarget(env: CommandEnv, arg: unknown): Promise<FileTarget | null> {
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
  if (await confirm(`Discard changes to ${file.path} in ${shortId(commit)}?`, 'Discard')) {
    await env.operations.run('Discard', model, () =>
      model.repo.restoreFiles(commit.commitId, [file.path]),
    )
  }
}

async function discardDirectory(env: CommandEnv, arg: unknown): Promise<void> {
  const ctx = parseContext(arg)
  const target = contextCommit(env, arg)
  if (!target || !ctx.path || target.commit.isImmutable) {
    return
  }
  const paths = changedPathsInDirectory(await changedFiles(target), ctx.path)
  if (paths.length === 0) {
    void vscode.window.showWarningMessage('Ukemi: no changes in that folder.')
    return
  }
  const count = paths.length === 1 ? '1 file' : `${paths.length} files`
  if (await confirm(`Discard changes in ${ctx.path} (${count})?`, 'Discard')) {
    await env.operations.run('Discard', target.model, () =>
      target.model.repo.restoreFiles(target.commit.commitId, paths),
    )
  }
}

const CHAT_ATTACH_COMMANDS = [
  'composer.addfilestocomposer',
  'workbench.action.chat.attachFile',
] as const

interface ChatResource {
  resourceUri: vscode.Uri
  contextValue?: string
  root?: string
}

function isScmResource(arg: unknown): arg is ChatResource {
  return (
    typeof arg === 'object' &&
    arg !== null &&
    'resourceUri' in arg &&
    (arg as { resourceUri?: unknown }).resourceUri instanceof vscode.Uri
  )
}

function pathInside(root: string, full: string): string | null {
  const rel = relative(root, full)
  if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
    return null
  }
  return full
}

async function attachFilesToChat(uris: readonly vscode.Uri[]): Promise<void> {
  const available = new Set(await vscode.commands.getCommands(false))
  const command = CHAT_ATTACH_COMMANDS.find((id) => available.has(id))
  if (!command) {
    void vscode.window.showWarningMessage('Ukemi: this editor has no command to add a file to chat.')
    return
  }
  for (const uri of uris) {
    await vscode.commands.executeCommand(command, uri)
  }
}

async function addToChat(env: CommandEnv, ...args: unknown[]): Promise<void> {
  const uris: vscode.Uri[] = []
  let removed = false
  for (const arg of args) {
    const resolved = await chatFile(env, arg)
    if (resolved === 'removed') {
      removed = true
    } else if (resolved) {
      uris.push(resolved)
    }
  }
  if (uris.length === 0) {
    if (removed) {
      void vscode.window.showWarningMessage('Ukemi: a deleted file is not on disk.')
    }
    return
  }
  await attachFilesToChat(uris)
}

async function chatFile(env: CommandEnv, arg: unknown): Promise<vscode.Uri | 'removed' | null> {
  if (isScmResource(arg)) {
    if (arg.contextValue === 'removed') {
      return 'removed'
    }
    if (arg.resourceUri.scheme !== 'file' || !arg.root) {
      return null
    }
    return pathInside(arg.root, arg.resourceUri.fsPath) ? arg.resourceUri : null
  }
  const target = await fileTarget(env, arg)
  if (!target) {
    return null
  }
  if (target.file.status === 'removed') {
    return 'removed'
  }
  const full = pathInside(target.model.root, join(target.model.root, target.file.path))
  return full ? vscode.Uri.file(full) : null
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
    'ukemi.file.discardDirectory': (arg) => discardDirectory(env, arg),
    'ukemi.file.copyPath': withFile(env, async ({ file }) =>
      vscode.env.clipboard.writeText(file.path),
    ),
    'ukemi.file.addToChat': (...args: unknown[]) => addToChat(env, ...args),
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
