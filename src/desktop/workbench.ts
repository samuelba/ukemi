import { open } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { CleanupHostMessage, CleanupWebviewMessage } from '../../shared/cleanup'
import type { EditorHostMessage, EditorWebviewMessage } from '../../shared/editor'
import type {
  DesktopHostMessage,
  DiffDocument,
  DiffFile,
  DiffSideText,
} from '../../shared/desktopProtocol'
import type { ChangedFile } from '../../shared/model'
import type { CommitView } from '../../shared/protocol'
import type { SplitHostMessage, SplitWebviewMessage } from '../../shared/split'
import { cleanupController } from '../app/cleanupController'
import { shortId, type CommandEnv, type Workbench } from '../app/commands/context'
import { editorController } from '../app/editorController'
import type { PanelChannel, PanelHandler } from '../app/panel'
import {
  BINARY_PLACEHOLDER,
  commitDiffEntries,
  commitDiffTitle,
  fileAtRevision,
  interdiffText,
  revisionText,
  versionDiffEntries,
  versionDiffTitle,
  type DiffEntry,
  type FileSide,
} from '../app/revisionContent'
import { splitController } from '../app/splitController'
import type { RepoModel } from '../repo/repoModel'
import type { SplitToolPaths } from '../split/toolRun'
import { mapLimited } from '../util/mapLimited'

// Bigger files are left out of the diff pane. Open them in an editor instead.
export const MAX_DIFF_BYTES = 2_000_000
const TOO_LARGE = '(file too large to show)'
const LOAD_CONCURRENCY = 8

export type PanelEntry = 'split' | 'cleanup' | 'editor'

export type OpenPanelWindow = <H, W>(
  entry: PanelEntry,
  title: string,
  connect: (channel: PanelChannel<H>) => PanelHandler<W>,
  // A tab with the same key is shown again instead of opening another one.
  key?: string,
) => void

export interface DesktopWorkbenchDeps {
  post(message: DesktopHostMessage): void
  openPanelWindow: OpenPanelWindow
  openWindow(root: string): void
  addFolder(root: string): void
  hasFolders(): boolean
  openSettings(): void
  openRepositorySettings(root: string): Promise<void>
  openTerminal(cwd: string, name: string): void
  openPath(fsPath: string): Promise<void>
  installJj(): Promise<void>
  splitPaths: SplitToolPaths
}

function looksBinary(data: Buffer): boolean {
  return data.subarray(0, 8000).includes(0)
}

async function diskText(path: string): Promise<DiffSideText> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    if (size > MAX_DIFF_BYTES) {
      return { text: TOO_LARGE, isBinary: true }
    }
    const data = await handle.readFile()
    return looksBinary(data)
      ? { text: BINARY_PLACEHOLDER, isBinary: true }
      : { text: data.toString('utf8'), isBinary: false }
  } finally {
    await handle.close()
  }
}

async function sideText(model: RepoModel, side: FileSide): Promise<DiffSideText> {
  if (side.kind === 'disk') {
    try {
      return await diskText(join(model.root, side.path))
    } catch {
      return { text: '', isBinary: false }
    }
  }
  const text = await revisionText(model, side.commitId, side.path)
  if (text === BINARY_PLACEHOLDER) {
    return { text, isBinary: true }
  }
  return text.length > MAX_DIFF_BYTES
    ? { text: TOO_LARGE, isBinary: true }
    : { text, isBinary: false }
}

async function diffFiles(
  model: RepoModel,
  entries: readonly DiffEntry[],
  statuses: ReadonlyMap<string, ChangedFile['status']>,
): Promise<DiffFile[]> {
  return mapLimited(entries, LOAD_CONCURRENCY, async (entry) => ({
    path: entry.path,
    status: statuses.get(entry.path) ?? 'changed',
    left: entry.left ? await sideText(model, entry.left) : null,
    right: entry.right ? await sideText(model, entry.right) : null,
  }))
}

function statusMap(files: readonly ChangedFile[]): Map<string, ChangedFile['status']> {
  return new Map(files.map((file) => [file.path, file.status]))
}

// Shows diffs in the window's detail pane and opens Split and Clean up in their own windows.
export function desktopWorkbench(deps: DesktopWorkbenchDeps, env: () => CommandEnv): Workbench {
  const show = (document: DiffDocument) => deps.post({ type: 'desktop.diff', document })
  // Open editor tabs by key, so opening a file again shows its tab.
  const editors = new Map<string, PanelChannel<EditorHostMessage>>()

  // A conflicted file opens in the change's resolver tab, which steps through its conflicts.
  const openEditor = async (model: RepoModel, commit: CommitView, path: string) => {
    const conflicted = commit.hasConflict
      ? (await model.filesFor(commit.commitId)).some((f) => f.path === path && f.isConflicted)
      : false
    const key = conflicted
      ? `resolve:${model.root}:${commit.changeId}`
      : `edit:${model.root}:${commit.changeId}:${path}`
    const title = conflicted
      ? `Resolve ${shortId(commit)}`
      : `${basename(path)} @ ${shortId(commit)}`
    const open = editors.get(key)
    if (open && !open.isClosed) {
      void open.post({ type: 'show', path })
    }
    deps.openPanelWindow<EditorHostMessage, EditorWebviewMessage>(
      'editor',
      title,
      (channel) => {
        editors.set(key, channel)
        return editorController(
          env(),
          { model, changeId: commit.changeId, path },
          channel,
          deps.splitPaths,
        )
      },
      key,
    )
  }

  const showCommit = async (
    model: RepoModel,
    commit: CommitView,
    files: ChangedFile[],
    focus?: string,
  ) => {
    const loaded = await diffFiles(model, commitDiffEntries(commit, files), statusMap(files))
    show({
      kind: 'files',
      title: commitDiffTitle(commit),
      files: loaded,
      ...(focus ? { focus } : {}),
    })
  }

  return {
    openFileDiff: (model, commit, file) => showCommit(model, commit, [file], file.path),
    openCommitDiff: (model, commit, files) => showCommit(model, commit, files),
    openVersionDiff: async (model, commit, from, to) => {
      const entries = await versionDiffEntries(model, from, to)
      if (entries.length === 0) {
        show({
          kind: 'patch',
          title: versionDiffTitle(commit, from, to),
          text: await interdiffText(model, from.commitId, to.commitId),
        })
        return
      }
      show({
        kind: 'files',
        title: versionDiffTitle(commit, from, to),
        files: await diffFiles(model, entries, new Map()),
      })
    },
    openFileAtRevision: async (model, commit, path) => {
      const side = await sideText(model, fileAtRevision(commit, path))
      show({ kind: 'file', title: `${path} @ ${shortId(commit)}`, path, text: side.text })
    },
    openEditor,
    openFileExternally: (fsPath) => deps.openPath(fsPath),
    openSplit: async (target) => {
      deps.openPanelWindow<SplitHostMessage, SplitWebviewMessage>(
        'split',
        `Split ${shortId(target.commit)}`,
        (channel) => splitController(env(), target, channel, deps.splitPaths),
      )
    },
    openCleanup: (model) => {
      deps.openPanelWindow<CleanupHostMessage, CleanupWebviewMessage>(
        'cleanup',
        'Clean up',
        (channel) => cleanupController(env(), model, channel),
      )
    },
    openSettings: () => deps.openSettings(),
    openRepositorySettings: (root) => deps.openRepositorySettings(root),
    openWindow: async (root) => deps.openWindow(root),
    addFolder: (root) => {
      deps.addFolder(root)
      return true
    },
    openTerminal: (cwd, name) => deps.openTerminal(cwd, name),
    installJj: () => deps.installJj(),
    openFolder: async () => {
      const folder = await env().ui.pickFolder('Open Repository')
      if (!folder) {
        return
      }
      if (deps.hasFolders()) {
        deps.openWindow(folder)
      } else {
        deps.addFolder(folder)
      }
    },
  }
}
