import type { MenuItemConstructorOptions } from 'electron'
import type { ShellAction, ZoomStep } from '../../shared/desktopProtocol'
import type { ChangedFilesView } from '../../shared/protocol'
import {
  inlineActions,
  resolveMenu,
  type InlineAction,
  type MenuContext,
  type MenuEntry,
  type MenuManifest,
} from '../../shared/menus'
import packageJson from '../../package.json'
import { isAccelerator } from '../../shared/accelerators'
import { recentLabel } from './recentRepos'

// Commands of the standalone app alone. The extension never registers them, so they are not in
// package.json.
const DESKTOP_COMMANDS: MenuManifest['commands'] = [
  { command: 'ukemi.repoTab.rename', title: 'Rename...', category: 'Ukemi' },
  { command: 'ukemi.repoTab.pin', title: 'Pin', category: 'Ukemi', icon: '$(pin)' },
  { command: 'ukemi.repoTab.unpin', title: 'Unpin', category: 'Ukemi', icon: '$(pinned)' },
]

const DESKTOP_WEBVIEW_MENU: MenuManifest['menus'][string] = [
  {
    command: 'ukemi.repoTab.rename',
    group: '1_tab@1',
    when: "webviewSection == 'ukemi.repoTab'",
  },
  {
    command: 'ukemi.repoTab.pin',
    group: '1_tab@2',
    when: "webviewSection == 'ukemi.repoTab' && !isPinned",
  },
  {
    command: 'ukemi.repoTab.unpin',
    group: '1_tab@2',
    when: "webviewSection == 'ukemi.repoTab' && isPinned",
  },
]

const contributes: MenuManifest = packageJson.contributes

export const manifest: MenuManifest = {
  ...contributes,
  commands: [...contributes.commands, ...DESKTOP_COMMANDS],
  menus: {
    ...contributes.menus,
    'webview/context': [...DESKTOP_WEBVIEW_MENU, ...(contributes.menus['webview/context'] ?? [])],
    // Tab-only commands, kept out of the palette like the item-only ones in package.json.
    commandPalette: [
      ...DESKTOP_COMMANDS.map((c) => ({ command: c.command, when: 'false' })),
      ...(contributes.menus.commandPalette ?? []),
    ],
  },
}

const titles = new Map(manifest.commands.map((c) => [c.command, c.title]))

export function commandTitle(command: string): string {
  return titles.get(command) ?? command
}

export type RunCommand = (command: string, arg?: unknown) => void

export function menuTemplate(
  entries: readonly MenuEntry[],
  arg: unknown,
  run: RunCommand,
): MenuItemConstructorOptions[] {
  return entries.map((entry): MenuItemConstructorOptions => {
    switch (entry.kind) {
      case 'separator':
        return { type: 'separator' }
      case 'submenu':
        return { label: entry.label, submenu: menuTemplate(entry.items, arg, run) }
      case 'command':
        return { label: entry.title, click: () => run(entry.command, arg) }
    }
  })
}

// The menu VS Code shows on a webview item, from the item's merged `data-vscode-context`.
export function webviewMenu(
  context: MenuContext,
  offers: (command: string) => boolean,
): MenuEntry[] {
  return resolveMenu(manifest, 'webview/context', { webviewId: 'ukemi.graph', ...context }, offers)
}

// The menu VS Code shows on a tree item of the Bookmarks or Workspaces view.
export function treeItemMenu(
  view: string,
  contextValue: string,
  offers: (command: string) => boolean,
): MenuEntry[] {
  return resolveMenu(manifest, 'view/item/context', { view, viewItem: contextValue }, offers)
}

// The hover buttons VS Code shows on a tree item of the Bookmarks, Workspaces or Evolution view.
export function treeItemActions(
  view: string,
  contextValue: string,
  offers: (command: string) => boolean,
): InlineAction[] {
  return inlineActions(manifest, 'view/item/context', { view, viewItem: contextValue }, offers)
}

// The graph view's title bar menu, shown as the app's toolbar overflow.
export function graphTitleMenu(
  offers: (command: string) => boolean,
  changedFilesView: ChangedFilesView,
): MenuEntry[] {
  const context = { view: 'ukemi.graph', 'config.ukemi.changedFilesView': changedFilesView }
  return resolveMenu(manifest, 'view/title', context, offers)
}

// Every command a user can run by name: what the host offers, minus the item-only commands that
// package.json hides from VS Code's palette.
export function paletteCommands(offers: (command: string) => boolean) {
  const hidden = new Set(
    (manifest.menus.commandPalette ?? [])
      .filter((item) => item.when === 'false')
      .flatMap((item) => (item.command ? [item.command] : [])),
  )
  return manifest.commands
    .filter((c) => offers(c.command) && !hidden.has(c.command))
    .map((c) => ({ command: c.command, title: c.title, category: c.category }))
}

// A command of the app menu that takes a keyboard shortcut. `key` is the shortcut it has out of
// the box, empty for none.
export interface ShortcutAction {
  id: string
  menu: 'File' | 'Repository' | 'View'
  title: string
  key: string
}

function shortcut(
  menu: ShortcutAction['menu'],
  id: string,
  key = '',
  title = commandTitle(id),
): ShortcutAction {
  return { id, menu, title, key }
}

// The commands of the File, Repository and View menus, in menu order. Ids of commands that run
// a `ukemi.*` command are that command. The others name what the item does.
export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  shortcut('File', 'app.openRepository', 'CmdOrCtrl+O', 'Open Repository…'),
  shortcut('File', 'app.newWindow', 'CmdOrCtrl+Shift+N', 'New Window'),
  shortcut('File', 'ukemi.initRepo'),
  shortcut('File', 'app.settings', 'CmdOrCtrl+,', 'Settings'),
  shortcut('File', 'app.keyboardShortcuts', '', 'Keyboard Shortcuts'),
  shortcut('Repository', 'ukemi.fetch', 'CmdOrCtrl+Shift+F'),
  shortcut('Repository', 'ukemi.push', 'CmdOrCtrl+Shift+P'),
  shortcut('Repository', 'ukemi.pushCurrent'),
  shortcut('Repository', 'ukemi.newFromTrunk', 'CmdOrCtrl+Shift+T'),
  shortcut('Repository', 'ukemi.goTo', 'CmdOrCtrl+G'),
  shortcut('Repository', 'ukemi.undo'),
  shortcut('Repository', 'ukemi.redo'),
  shortcut('Repository', 'ukemi.selectRepository'),
  shortcut('Repository', 'ukemi.addWorkspace'),
  shortcut('Repository', 'ukemi.cleanup'),
  shortcut('Repository', 'ukemi.forge.signIn'),
  shortcut('Repository', 'ukemi.forge.signOut'),
  shortcut('Repository', 'ukemi.refresh', 'F5'),
  shortcut('View', 'app.palette', 'CmdOrCtrl+K', 'Command Palette…'),
  shortcut('View', 'app.toggleSidebar', 'CmdOrCtrl+B', 'Toggle Sidebar'),
  shortcut('View', 'app.toggleTerminal', 'CmdOrCtrl+`', 'Terminal'),
  shortcut('View', 'app.toggleLog', 'CmdOrCtrl+Shift+U', 'Log'),
  shortcut('View', 'app.toggleDetail', 'CmdOrCtrl+J', 'Toggle Details'),
  shortcut('View', 'ukemi.toggleAutoFetch'),
  shortcut('View', 'ukemi.toggleGitTags'),
  shortcut('View', 'ukemi.view.asList'),
  shortcut('View', 'ukemi.view.asTree'),
  // Ctrl+= zooms in as in VS Code and browsers. Electron's own role wants Ctrl+Shift+= on most
  // keyboards.
  shortcut('View', 'app.zoomIn', 'CmdOrCtrl+=', 'Zoom In'),
  shortcut('View', 'app.zoomOut', 'CmdOrCtrl+-', 'Zoom Out'),
  shortcut('View', 'app.resetZoom', 'CmdOrCtrl+0', 'Reset Zoom'),
]

// The setting with the user's shortcuts, by action id, like `{ "ukemi.fetch": "Alt+F" }`.
export const KEYBINDINGS = 'desktop.keybindings'

export type ShortcutKeys = Readonly<Record<string, string>>

// The shortcut of every action: the user's own from settings.json, else the default. An empty
// string removes a shortcut. Unknown actions and keys the menu cannot bind are left out.
export function shortcutKeys(stored: unknown): ShortcutKeys {
  const own =
    typeof stored === 'object' && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {}
  return Object.fromEntries(
    SHORTCUT_ACTIONS.map(({ id, key }) => {
      const value = own[id]
      const isValid = typeof value === 'string' && (value === '' || isAccelerator(value))
      return [id, isValid ? value : key]
    }),
  )
}

export interface AppMenuActions {
  run: RunCommand
  shell: (action: ShellAction) => void
  openRepository: () => void
  // The repositories used last, newest first, and the home folder their labels shorten.
  recent: { roots: readonly string[]; home: string }
  openRecent: (root: string) => void
  clearRecent: () => void
  // The zoom of the windows, as a percentage.
  zoom: { percent: number; step: (step: ZoomStep) => void }
  changedFilesView: ChangedFilesView
  // The shortcut of each action in SHORTCUT_ACTIONS, by its id.
  keys: ShortcutKeys
  newWindow: () => void
  openSettings: () => void
  openKeyboardShortcuts: () => void
  openLog: () => void
  about: () => void
  openExternal: (url: string) => void
  isDevelopment: boolean
}

// A label shows `&` as is. Otherwise it marks the access key on Windows and Linux.
function literal(label: string): string {
  return label.replace(/&/g, '&&')
}

function recentMenu(actions: AppMenuActions): MenuItemConstructorOptions[] {
  const { roots, home } = actions.recent
  if (roots.length === 0) {
    return [{ label: 'No Recent Repositories', enabled: false }]
  }
  return [
    ...roots.map((root): MenuItemConstructorOptions => ({
      label: literal(recentLabel(root, home)),
      click: () => actions.openRecent(root),
    })),
    { type: 'separator' },
    { label: 'Clear Recently Opened', click: actions.clearRecent },
  ]
}

const shortcutTitles = new Map(SHORTCUT_ACTIONS.map((a) => [a.id, a.title]))

export function appMenuTemplate(actions: AppMenuActions): MenuItemConstructorOptions[] {
  const { run, keys } = actions
  const isMac = process.platform === 'darwin'
  // An item of SHORTCUT_ACTIONS, with the user's shortcut.
  const item = (
    id: string,
    click: () => void,
    options: MenuItemConstructorOptions = {},
  ): MenuItemConstructorOptions => {
    const key = keys[id]
    return {
      label: shortcutTitles.get(id) ?? commandTitle(id),
      click,
      ...(key ? { accelerator: key } : {}),
      ...options,
    }
  }
  const command = (id: string) => item(id, () => run(id))
  const shell = (id: string, action: ShellAction) => item(id, () => actions.shell(action))
  const { zoom } = actions
  const isZoomed = zoom.percent !== 100
  return [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: '&File',
      submenu: [
        item('app.openRepository', actions.openRepository),
        { label: 'Open &Recent', submenu: recentMenu(actions) },
        item('app.newWindow', actions.newWindow),
        { type: 'separator' },
        command('ukemi.initRepo'),
        { type: 'separator' },
        item('app.settings', actions.openSettings),
        item('app.keyboardShortcuts', actions.openKeyboardShortcuts),
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: '&Repository',
      submenu: [
        command('ukemi.fetch'),
        command('ukemi.push'),
        command('ukemi.pushCurrent'),
        { type: 'separator' },
        command('ukemi.newFromTrunk'),
        shell('ukemi.goTo', 'goTo'),
        { type: 'separator' },
        command('ukemi.undo'),
        command('ukemi.redo'),
        { type: 'separator' },
        command('ukemi.selectRepository'),
        command('ukemi.addWorkspace'),
        command('ukemi.cleanup'),
        { type: 'separator' },
        command('ukemi.forge.signIn'),
        command('ukemi.forge.signOut'),
        { type: 'separator' },
        command('ukemi.refresh'),
      ],
    },
    {
      label: '&View',
      submenu: [
        shell('app.palette', 'palette'),
        { type: 'separator' },
        shell('app.toggleSidebar', 'toggleSidebar'),
        shell('app.toggleTerminal', 'toggleTerminal'),
        shell('app.toggleLog', 'toggleLog'),
        shell('app.toggleDetail', 'toggleDetail'),
        { type: 'separator' },
        command('ukemi.toggleAutoFetch'),
        command('ukemi.toggleGitTags'),
        {
          ...command('ukemi.view.asList'),
          type: 'radio',
          checked: actions.changedFilesView === 'list',
        },
        {
          ...command('ukemi.view.asTree'),
          type: 'radio',
          checked: actions.changedFilesView === 'tree',
        },
        { type: 'separator' },
        // Ctrl with the mouse wheel zooms too, in the window.
        item('app.zoomIn', () => zoom.step('in')),
        item('app.zoomOut', () => zoom.step('out')),
        item('app.resetZoom', () => zoom.step('reset'), {
          ...(isZoomed ? { label: `Reset Zoom (${zoom.percent}%)` } : {}),
          enabled: isZoomed,
        }),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(actions.isDevelopment
          ? [
              { type: 'separator' as const },
              { role: 'reload' as const },
              { role: 'toggleDevTools' as const },
            ]
          : []),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Jujutsu Documentation',
          click: () => actions.openExternal('https://docs.jj-vcs.dev/latest/'),
        },
        { label: 'Ukemi Website', click: () => actions.openExternal('https://samuelba.dev/ukemi') },
        {
          label: 'Report an Issue',
          click: () => actions.openExternal('https://github.com/samuelba/ukemi/issues'),
        },
        { type: 'separator' },
        { label: 'Show Log', click: actions.openLog },
        { type: 'separator' },
        { label: 'About Ukemi', click: actions.about },
      ],
    },
  ]
}
