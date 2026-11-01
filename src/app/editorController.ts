import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { EditorHostMessage, EditorState, EditorWebviewMessage } from '../../shared/editor'
import type { Commit } from '../../shared/model'
import type { RepoModel } from '../repo/repoModel'
import { ensureWrapper, withPlanTool, type SplitToolPaths } from '../split/toolRun'
import { errorMessage } from '../util/logger'
import { shortId, type CommandEnv } from './commands/context'
import type { PanelChannel, PanelHandler } from './panel'
import { confirm } from './ui'

// Bigger files open read-only. An editor outside Ukemi handles them better.
export const MAX_EDIT_BYTES = 2_000_000
const BINARY_PROBE_BYTES = 8000

export interface EditorTarget {
  model: RepoModel
  changeId: string
  path: string
}

interface FileText {
  text: string
  readOnly: string | null
}

const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('save'), text: z.string(), baseHash: z.string() }),
  z.object({ type: z.literal('reload') }),
  z.object({ type: z.literal('openPath'), path: z.string(), isDirty: z.boolean() }),
  z.object({ type: z.literal('openExternal') }),
  z.object({ type: z.literal('close'), isDirty: z.boolean() }),
])

export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function decodeFile(data: Buffer): FileText {
  if (data.length > MAX_EDIT_BYTES) {
    return { text: '', readOnly: 'This file is too large to edit here.' }
  }
  if (data.subarray(0, BINARY_PROBE_BYTES).includes(0)) {
    return { text: '', readOnly: 'This is a binary file.' }
  }
  return { text: data.toString('utf8'), readOnly: null }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

// The change's commit as jj sees it now. Null when it is gone or divergent.
async function currentCommit(model: RepoModel, changeId: string): Promise<Commit | null> {
  try {
    const commits = await model.repo.log(changeId)
    return commits.length === 1 ? (commits[0] ?? null) : null
  } catch {
    return null
  }
}

// The working copy's file is the one on disk; jj writes conflict markers into it.
async function readText(model: RepoModel, commit: Commit, path: string): Promise<FileText> {
  let data: Buffer
  try {
    data = commit.isWorkingCopy
      ? await readFile(join(model.root, path))
      : await model.repo.fileContent(commit.commitId, path)
  } catch (error: unknown) {
    if (commit.isWorkingCopy && !isMissing(error)) {
      throw error
    }
    data = Buffer.alloc(0)
  }
  const file = decodeFile(data)
  if (!file.readOnly && commit.isImmutable) {
    return { ...file, readOnly: `${shortId(commit)} is immutable.` }
  }
  return file
}

async function conflictedPaths(model: RepoModel, commit: Commit): Promise<string[]> {
  const files = await model.filesFor(commit.commitId)
  return files.filter((file) => file.isConflicted).map((file) => file.path)
}

// Writes the file into the change. The working copy is written on disk and snapshotted; any
// other change is rewritten in place by `jj diffedit`, which rebases its descendants.
async function writeText(
  model: RepoModel,
  commit: Commit,
  path: string,
  text: string,
  paths: SplitToolPaths,
): Promise<void> {
  if (commit.isWorkingCopy) {
    await writeFile(join(model.root, path), text)
    await model.repo.snapshot()
    return
  }
  const tool = await ensureWrapper(paths)
  const plan = [{ path, content: Buffer.from(text, 'utf8').toString('base64') }]
  await withPlanTool(tool, plan, (config) =>
    model.repo.writeFilesWithTool(commit.commitId, [path], config),
  )
}

// Loads one file of a change into the editor tab and writes it back on save.
export function editorController(
  env: CommandEnv,
  target: EditorTarget,
  panel: PanelChannel<EditorHostMessage>,
  paths: SplitToolPaths,
): PanelHandler<EditorWebviewMessage> {
  const { model, changeId } = target
  let path = target.path
  let state: EditorState | null = null

  const post = (message: EditorHostMessage) => {
    if (!panel.isClosed) {
      void panel.post(message)
    }
  }

  const load = async (): Promise<void> => {
    try {
      const commit = await currentCommit(model, changeId)
      if (!commit) {
        post({ type: 'error', text: 'The change is no longer visible.' })
        return
      }
      const [file, conflicted] = await Promise.all([
        readText(model, commit, path),
        conflictedPaths(model, commit),
      ])
      state = {
        changeId,
        changeLabel: shortId(commit),
        commitId: commit.commitId,
        isWorkingCopy: commit.isWorkingCopy,
        path,
        text: file.text,
        baseHash: textHash(file.text),
        readOnly: file.readOnly,
        conflictedPaths: conflicted,
      }
      post({ type: 'load', state })
    } catch (error: unknown) {
      post({ type: 'error', text: `Could not open ${path}: ${errorMessage(error)}` })
    }
  }

  // False when the user would rather reload than overwrite a file that changed meanwhile.
  const confirmOverwrite = async (commit: Commit, baseHash: string): Promise<boolean> => {
    const now = await readText(model, commit, path)
    if (now.readOnly) {
      post({ type: 'error', text: now.readOnly })
      return false
    }
    if (textHash(now.text) === baseHash) {
      return true
    }
    const choice = await env.ui.ask(
      'warning',
      `${path} changed since it was opened.`,
      { detail: 'Overwrite it with your version, or reload and lose your edits?' },
      'Overwrite',
      'Reload',
    )
    if (choice === 'Reload') {
      await load()
    }
    return choice === 'Overwrite'
  }

  const save = async (text: string, baseHash: string): Promise<void> => {
    const commit = await currentCommit(model, changeId)
    if (!commit) {
      post({ type: 'error', text: 'The change is no longer visible.' })
      return
    }
    if (!(await confirmOverwrite(commit, baseHash))) {
      return
    }
    const label = state?.conflictedPaths.includes(path) ? 'Resolve' : 'Edit file'
    post({ type: 'busy', label: `${label}…` })
    const saved = await env.operations.run(label, model, async () => {
      await writeText(model, commit, path, text, paths)
      return true
    })
    await model.settled()
    post({ type: 'busy', label: null })
    if (!saved) {
      post({ type: 'error', text: `${label} failed. The log has the details.` })
      return
    }
    await load()
  }

  const openPath = async (next: string, isDirty: boolean): Promise<void> => {
    if (next === path) {
      return
    }
    if (!state?.conflictedPaths.includes(next)) {
      post({ type: 'error', text: `${next} is not a conflicted file of this change.` })
      return
    }
    if (isDirty && !(await confirm(env.ui, `Discard your edits to ${path}?`, 'Discard'))) {
      return
    }
    path = next
    await load()
  }

  const close = async (isDirty: boolean): Promise<void> => {
    if (!isDirty || (await confirm(env.ui, `Discard your edits to ${path}?`, 'Discard'))) {
      panel.close()
    }
  }

  return async (raw) => {
    const parsed = messageSchema.safeParse(raw)
    if (!parsed.success) {
      env.logger.warn(`editor: ignored a malformed message: ${parsed.error.message}`)
      return
    }
    const message = parsed.data
    switch (message.type) {
      case 'ready':
      case 'reload':
        await load()
        return
      case 'save':
        await save(message.text, message.baseHash)
        return
      case 'openPath':
        await openPath(message.path, message.isDirty)
        return
      case 'openExternal':
        if (state?.isWorkingCopy) {
          await env.workbench.openFileExternally(join(model.root, path))
        }
        return
      case 'close':
        await close(message.isDirty)
        return
    }
  }
}
