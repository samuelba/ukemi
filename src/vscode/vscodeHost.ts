import { sep } from 'node:path'
import * as vscode from 'vscode'
import type { Event } from '../app/events'
import type { FolderSource, Host, WatchRepo, WindowState } from '../app/host'
import type { Settings } from '../app/settings'
import type { OpenPick, PickItem, TypedPickOptions, Ui } from '../app/ui'

function pickOrType<T extends PickItem>(
  items: readonly T[],
  options: TypedPickOptions = {},
): OpenPick<T> {
  const pick = vscode.window.createQuickPick<T>()
  const title = options.title
  pick.title = title
  pick.placeholder = options.placeholder
  pick.matchOnDescription = options.matchOnDescription ?? false
  pick.matchOnDetail = options.matchOnDetail ?? false
  pick.items = [...items]
  let isHidden = false
  const choice = new Promise<T | string | undefined>((resolve) => {
    pick.onDidAccept(() => {
      const selected = pick.selectedItems[0]
      const value = selected ?? (pick.value.trim() || undefined)
      const problem = options.validate?.(selected?.label ?? pick.value.trim())
      if (problem) {
        pick.title = title ? `${title}: ${problem}` : problem
        return
      }
      resolve(value)
      pick.hide()
    })
    pick.onDidHide(() => {
      isHidden = true
      resolve(undefined)
      pick.dispose()
    })
    pick.show()
  })
  return {
    choice,
    update(next) {
      if (!isHidden) {
        pick.items = [...next]
      }
    },
  }
}

export const vscodeUi: Ui = {
  info: (text, ...actions) =>
    Promise.resolve(vscode.window.showInformationMessage(text, ...actions)),
  warn: (text, ...actions) => Promise.resolve(vscode.window.showWarningMessage(text, ...actions)),
  error: (text, ...actions) => Promise.resolve(vscode.window.showErrorMessage(text, ...actions)),
  ask: (level, text, options, ...actions) => {
    const show =
      level === 'info' ? vscode.window.showInformationMessage : vscode.window.showWarningMessage
    return Promise.resolve(show(text, { modal: true, detail: options.detail }, ...actions))
  },
  input: (options) =>
    Promise.resolve(
      vscode.window.showInputBox({
        title: options.title,
        prompt: options.prompt,
        value: options.value,
        placeHolder: options.placeholder,
        password: options.password,
        ignoreFocusOut: true,
        validateInput: options.validate,
      }),
    ),
  pick: (items, options = {}) =>
    Promise.resolve(
      vscode.window.showQuickPick([...items], {
        title: options.title,
        placeHolder: options.placeholder,
        matchOnDescription: options.matchOnDescription,
        matchOnDetail: options.matchOnDetail,
      }),
    ),
  pickMany: (items, options = {}) =>
    Promise.resolve(
      vscode.window.showQuickPick([...items], {
        canPickMany: true,
        title: options.title,
        placeHolder: options.placeholder,
        matchOnDescription: options.matchOnDescription,
        matchOnDetail: options.matchOnDetail,
      }),
    ),
  pickOrType,
  pickFolder: async (openLabel) => {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      openLabel,
    })
    return picked?.[0]?.fsPath
  },
  progress: (title, task) =>
    Promise.resolve(
      vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, task),
    ),
  openExternal: (url) => Promise.resolve(vscode.env.openExternal(vscode.Uri.parse(url))),
  copy: (text) => Promise.resolve(vscode.env.clipboard.writeText(text)),
}

const onDidFocus: Event<void> = (listener) =>
  vscode.window.onDidChangeWindowState((state) => {
    if (state.focused) {
      listener()
    }
  })

export const vscodeWindowState: WindowState = {
  get isFocused() {
    return vscode.window.state.focused
  },
  onDidFocus,
  get isTrusted() {
    return vscode.workspace.isTrusted
  },
  onDidGrantTrust: (listener) => vscode.workspace.onDidGrantWorkspaceTrust(() => listener()),
}

function editorFile(editor: vscode.TextEditor | undefined): string | undefined {
  return editor?.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined
}

export const vscodeFolders: FolderSource = {
  folders: () =>
    (vscode.workspace.workspaceFolders ?? []).map((f) => ({ name: f.name, path: f.uri.fsPath })),
  onDidChangeFolders: (listener) => vscode.workspace.onDidChangeWorkspaceFolders(() => listener()),
  activeFile: () => editorFile(vscode.window.activeTextEditor),
  onDidChangeActiveFile: (listener) =>
    vscode.window.onDidChangeActiveTextEditor((editor) => listener(editorFile(editor))),
}

function isInternalPath(path: string): boolean {
  return path.includes(`${sep}.jj${sep}`) || path.includes(`${sep}.git${sep}`)
}

export const watchRepo: WatchRepo = (root, handlers) => {
  const files = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'))
  const onFile = (uri: vscode.Uri) => {
    if (!isInternalPath(uri.fsPath)) {
      handlers.onFile()
    }
  }
  files.onDidChange(onFile)
  files.onDidCreate(onFile)
  files.onDidDelete(onFile)

  const ops = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(root, '.jj/repo/op_heads/heads/*'),
  )
  ops.onDidCreate(() => handlers.onOperation())
  ops.onDidChange(() => handlers.onOperation())
  return vscode.Disposable.from(files, ops)
}

export function vscodeHost(context: vscode.ExtensionContext, settings: Settings): Host {
  return {
    ui: vscodeUi,
    settings,
    window: vscodeWindowState,
    folders: vscodeFolders,
    watchRepo,
    store: context.workspaceState,
    secrets: context.secrets,
  }
}
