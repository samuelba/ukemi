import type { InlineAction, MenuEntry } from './menus'
import type { ChangedFile } from './model'
import type { CommitView, HostMessage, WebviewMessage } from './protocol'

// Messages of the standalone app's window shell. They share the graph's channel with
// `HostMessage` and `WebviewMessage`, and every type starts with `desktop.`.

export type MessageLevel = 'info' | 'warning' | 'error'

export interface UiPickItem {
  label: string
  description?: string
  detail?: string
}

export type UiRequest =
  | {
      kind: 'message'
      level: MessageLevel
      text: string
      detail?: string
      modal: boolean
      actions: string[]
    }
  | {
      kind: 'input'
      title?: string
      prompt?: string
      value?: string
      placeholder?: string
      password?: boolean
    }
  | {
      kind: 'pick'
      items: UiPickItem[]
      title?: string
      placeholder?: string
      matchOnDescription?: boolean
      matchOnDetail?: boolean
      // `many` returns item indexes. `typed` also accepts the typed text.
      many: boolean
      typed: boolean
    }
  | { kind: 'progress'; title: string }

// The answer to a `UiRequest`. A dismissed request answers `cancel`.
export type UiAnswer =
  | { kind: 'cancel' }
  | { kind: 'action'; action: string }
  | { kind: 'text'; value: string }
  | { kind: 'item'; index: number }
  | { kind: 'items'; indexes: number[] }

export interface SidePanelRow {
  id: string
  label: string
  description: string
  tooltip: string
  icon: string
  // Matches `viewItem` in the `view/item/context` menus of package.json.
  contextValue: string
  view: 'ukemi.bookmarks' | 'ukemi.workspaces' | 'ukemi.evolution' | 'ukemi.operations'
  // Handed to the commands of the row's menu, as the tree item is in VS Code.
  arg: unknown
  defaultCommand?: string
  // The hover buttons of the row, as VS Code shows them on the tree item.
  inline?: InlineAction[]
}

export interface SidePanelGroup {
  id: string
  label: string
  icon: string
  rows: SidePanelRow[]
}

export interface SidePanels {
  bookmarks: SidePanelGroup[]
  workspaces: SidePanelRow[]
  operations: SidePanelRow[]
}

export interface DiffSideText {
  text: string
  isBinary: boolean
}

export interface DiffFile {
  path: string
  status: ChangedFile['status'] | 'changed'
  // A missing side is an added or removed file.
  left: DiffSideText | null
  right: DiffSideText | null
}

export type DiffDocument =
  | { kind: 'files'; title: string; files: DiffFile[]; focus?: string }
  | { kind: 'patch'; title: string; text: string }
  | { kind: 'file'; title: string; path: string; text: string }

export interface ChangeDetail {
  repoId: string
  commit: CommitView
  files: ChangedFile[]
  // The earlier versions of the change, newest first. Null while they load.
  evolution: SidePanelRow[] | null
}

// A Split or Clean up view, shown as a tab next to the change details.
export interface PanelTab {
  id: string
  kind: 'split' | 'cleanup' | 'editor'
  title: string
}

// A command whose keyboard shortcut the settings form can change.
export interface ShortcutField {
  id: string
  // The menu it is in, which groups it in the form.
  menu: string
  title: string
  // In Electron's accelerator syntax, empty for none.
  default: string
}

export interface SettingOption {
  value: string
  description?: string
}

// One `ukemi.*` setting from package.json, for the settings form.
export interface SettingField {
  // Without the `ukemi.` prefix, as stored in settings.json.
  key: string
  group: string
  title: string
  description: string
  type: 'boolean' | 'string' | 'number' | 'enum' | 'list' | 'map' | 'shortcuts'
  options?: SettingOption[]
  minimum?: number
  maximum?: number
  pattern?: string
  patternMessage?: string
  default: unknown
  // Undefined when the user has not set it.
  value: unknown
  // The commands a `shortcuts` field binds. Its value maps their ids to the user's own keys.
  shortcuts?: ShortcutField[]
  // A repository may override it. See shared/settingsScope.ts.
  isRepositoryScoped: boolean
  // The labels of the repositories that override it.
  overriddenIn: string[]
}

// The repository the settings form edits in its "This repository" mode.
export interface SettingsRepository {
  id: string
  label: string
  // Its overrides, by key.
  values: Record<string, unknown>
}

export interface FontSpec {
  // A CSS font-family list.
  family: string
  // In CSS pixels.
  size: number
  // A CSS font weight.
  weight: string
}

export interface Fonts {
  editor: FontSpec
  terminal: FontSpec
}

export interface AboutInfo {
  name: string
  description: string
  version: string
  license: string
  copyright: string
  website: string
  repository: string
  jj: { path: string; version: string } | null
  electron: string
  chromium: string
  node: string
  os: string
  userData: string
}

export interface LogLine {
  time: string
  level: 'info' | 'warning' | 'error'
  message: string
}

export interface PaletteCommand {
  command: string
  title: string
  category?: string
}

export type ShellAction =
  | 'palette'
  | 'goTo'
  | 'toggleSidebar'
  | 'toggleDetail'
  | 'settings'
  | 'keyboardShortcuts'
  | 'repositorySettings'
  | 'toggleLog'
  | 'showLog'
  | 'toggleTerminal'

// View > Zoom In, Zoom Out and Reset Zoom.
export type ZoomStep = 'in' | 'out' | 'reset'

export type DesktopHostMessage =
  | { type: 'desktop.ui'; id: number; request: UiRequest }
  | { type: 'desktop.uiUpdate'; id: number; items: UiPickItem[] }
  | { type: 'desktop.uiInvalid'; id: number; problem: string }
  | { type: 'desktop.uiClose'; id: number }
  | { type: 'desktop.panels'; panels: SidePanels }
  // Starts editing the name of a repository tab in place.
  | { type: 'desktop.startRename'; repoId: string }
  | { type: 'desktop.detail'; detail: ChangeDetail | null }
  | { type: 'desktop.diff'; document: DiffDocument }
  | { type: 'desktop.commands'; commands: PaletteCommand[]; toolbar: MenuEntry[] }
  | { type: 'desktop.action'; action: ShellAction }
  | { type: 'desktop.window'; title: string; platform: string }
  | { type: 'desktop.tabOpen'; tab: PanelTab }
  | { type: 'desktop.tabClose'; id: string }
  | { type: 'desktop.panel'; panelId: string; message: unknown }
  | {
      type: 'desktop.settings'
      fields: SettingField[]
      path: string
      repository: SettingsRepository | null
    }
  | { type: 'desktop.log'; lines: LogLine[]; replace: boolean }
  | { type: 'desktop.terminalOpen'; id: string; title: string; cwd: string }
  | { type: 'desktop.terminalData'; id: string; data: string }
  | { type: 'desktop.terminalExit'; id: string; code: number }
  | { type: 'desktop.fonts'; fonts: Fonts }
  // The zoom of every window, as a percentage.
  | { type: 'desktop.zoom'; percent: number }
  | { type: 'desktop.about'; info: AboutInfo; text: string }

export type DesktopRendererMessage =
  | { type: 'desktop.uiAnswer'; id: number; answer: UiAnswer }
  | { type: 'desktop.contextMenu'; context: Record<string, unknown>; x: number; y: number }
  | { type: 'desktop.rowMenu'; row: SidePanelRow; x: number; y: number }
  | { type: 'desktop.run'; command: string; arg?: unknown }
  | { type: 'desktop.titleMenu'; x: number; y: number }
  | { type: 'desktop.loadDiff'; commitId: string; path?: string }
  | { type: 'desktop.tabClosed'; id: string }
  | { type: 'desktop.panel'; panelId: string; message: unknown }
  | { type: 'desktop.loadSettings' }
  // A blank name gives the tab its folder name back.
  | { type: 'desktop.renameTab'; repoId: string; name: string }
  // `toIndex` counts the tabs as shown, for a drop. `offset` moves by places from where the
  // tab is now, so quick key presses add up. A tab stays among the pinned or the other tabs.
  | { type: 'desktop.moveTab'; repoId: string; toIndex?: number; offset?: number }
  // With a repoId, sets or removes (value undefined) that repository's override.
  | { type: 'desktop.setSetting'; key: string; value: unknown; repoId?: string }
  | { type: 'desktop.openSettingsFile' }
  | { type: 'desktop.openRepo' }
  | { type: 'desktop.zoom'; step: ZoomStep }
  // The settings form records a shortcut, so the menu must not act on the keys meanwhile.
  | { type: 'desktop.recordShortcut'; isRecording: boolean }
  | { type: 'desktop.closeRepo'; repoId: string }
  | { type: 'desktop.clearLog' }
  | { type: 'desktop.copy'; text: string }
  | { type: 'desktop.openExternal'; url: string }
  | { type: 'desktop.openLogFile' }
  // Asks for a new terminal. Main picks the folder and answers with desktop.terminalOpen.
  | { type: 'desktop.terminalCreate' }
  // The terminal view is ready and knows its size, so the shell can start.
  | { type: 'desktop.terminalStart'; id: string; cols: number; rows: number }
  | { type: 'desktop.terminalInput'; id: string; data: string }
  | { type: 'desktop.terminalResize'; id: string; cols: number; rows: number }
  | { type: 'desktop.terminalClose'; id: string }

export type ShellInbound = HostMessage | DesktopHostMessage
export type ShellOutbound = WebviewMessage | DesktopRendererMessage

export function isDesktopMessage(message: { type: string }): boolean {
  return message.type.startsWith('desktop.')
}
