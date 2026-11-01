import type { MenuItemConstructorOptions } from 'electron'
import type { ShellAction } from '../../shared/desktopProtocol'
import {
  inlineActions,
  resolveMenu,
  type InlineAction,
  type MenuContext,
  type MenuEntry,
  type MenuManifest,
} from '../../shared/menus'
import packageJson from '../../package.json'

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
export function graphTitleMenu(offers: (command: string) => boolean): MenuEntry[] {
  return resolveMenu(manifest, 'view/title', { view: 'ukemi.graph' }, offers)
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

export interface AppMenuActions {
  run: RunCommand
  shell: (action: ShellAction) => void
  openRepository: () => void
  newWindow: () => void
  openSettings: () => void
  openLog: () => void
  about: () => void
  openExternal: (url: string) => void
  isDevelopment: boolean
}

function command(id: string, run: RunCommand, accelerator?: string): MenuItemConstructorOptions {
  return { label: commandTitle(id), click: () => run(id), ...(accelerator ? { accelerator } : {}) }
}

export function appMenuTemplate(actions: AppMenuActions): MenuItemConstructorOptions[] {
  const { run } = actions
  const isMac = process.platform === 'darwin'
  return [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: '&File',
      submenu: [
        { label: 'Open Repository…', accelerator: 'CmdOrCtrl+O', click: actions.openRepository },
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: actions.newWindow },
        { type: 'separator' },
        command('ukemi.initRepo', run),
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: actions.openSettings },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: '&Repository',
      submenu: [
        command('ukemi.fetch', run, 'CmdOrCtrl+Shift+F'),
        command('ukemi.push', run, 'CmdOrCtrl+Shift+P'),
        command('ukemi.pushCurrent', run),
        { type: 'separator' },
        command('ukemi.newFromTrunk', run, 'CmdOrCtrl+Shift+T'),
        {
          label: commandTitle('ukemi.goTo'),
          accelerator: 'CmdOrCtrl+G',
          click: () => actions.shell('goTo'),
        },
        { type: 'separator' },
        command('ukemi.undo', run),
        command('ukemi.redo', run),
        { type: 'separator' },
        command('ukemi.selectRepository', run),
        command('ukemi.addWorkspace', run),
        command('ukemi.cleanup', run),
        { type: 'separator' },
        command('ukemi.forge.signIn', run),
        command('ukemi.forge.signOut', run),
        { type: 'separator' },
        command('ukemi.refresh', run, 'F5'),
      ],
    },
    {
      label: '&View',
      submenu: [
        {
          label: 'Command Palette…',
          accelerator: 'CmdOrCtrl+K',
          click: () => actions.shell('palette'),
        },
        { type: 'separator' },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => actions.shell('toggleSidebar'),
        },
        {
          label: 'Terminal',
          accelerator: 'CmdOrCtrl+`',
          click: () => actions.shell('toggleTerminal'),
        },
        {
          label: 'Log',
          accelerator: 'CmdOrCtrl+Shift+U',
          click: () => actions.shell('toggleLog'),
        },
        {
          label: 'Toggle Details',
          accelerator: 'CmdOrCtrl+J',
          click: () => actions.shell('toggleDetail'),
        },
        { type: 'separator' },
        command('ukemi.toggleAutoFetch', run),
        command('ukemi.toggleGitTags', run),
        command('ukemi.view.asList', run),
        command('ukemi.view.asTree', run),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
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
