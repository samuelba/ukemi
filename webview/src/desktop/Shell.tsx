import { useCallback, useEffect, useState } from 'react'
import type {
  AboutInfo,
  ChangeDetail,
  DesktopHostMessage,
  DesktopRendererMessage,
  DiffDocument,
  FontSpec,
  LogLine,
  PaletteCommand,
  PanelTab,
  SettingField,
  SidePanels,
} from '../../../shared/desktopProtocol'
import type { HostMessage, RepoSummary, ViewSettings } from '../../../shared/protocol'
import { App } from '../graph/App'
import { postMessage } from '../shared/hostApi'
import { useHostListener } from '../shared/hooks'
import { DetailPane } from './DetailPane'
import { Dialogs } from './Dialogs'
import { AboutDialog } from './AboutDialog'
import { BottomPanel, LOG_TAB, type TerminalTab } from './BottomPanel'
import { Palette } from './Palette'
import { RepoTabs } from './RepoTabs'
import { CHANGE_TAB, RightPane, SETTINGS_TAB } from './RightPane'
import { SettingsView } from './SettingsView'
import { Sidebar } from './Sidebar'
import { Splitter } from './Splitter'

const LAYOUT_KEY = 'ukemi.layout'
const MIN_SIDEBAR = 180
const MIN_DETAIL = 320
const MIN_LOG = 90
const LOG_LIMIT = 5_000

interface Layout {
  sidebar: number
  detail: number
  log: number
  showSidebar: boolean
  showDetail: boolean
  showPanel: boolean
}

const DEFAULT_LAYOUT: Layout = {
  sidebar: 248,
  detail: 560,
  log: 220,
  showSidebar: true,
  showDetail: true,
  showPanel: false,
}

const DEFAULT_SETTINGS: ViewSettings = {
  changeIdLength: 4,
  showFullPaths: false,
  showLineStats: false,
  showGitTags: true,
  changedFilesView: 'list',
  ciOnlyMine: true,
}

function readLayout(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as Partial<Layout>
    return { ...DEFAULT_LAYOUT, ...saved }
  } catch {
    return DEFAULT_LAYOUT
  }
}

const DEFAULT_FONT: FontSpec = { family: 'monospace', size: 13, weight: 'normal' }

// The diff view, ids and paths read these tokens, which tokens.css sets to a default.
function applyEditorFont(font: FontSpec): void {
  const root = document.documentElement.style
  root.setProperty('--vscode-editor-font-family', font.family)
  root.setProperty('--vscode-editor-font-size', `${font.size}px`)
  root.setProperty('--vscode-editor-font-weight', font.weight)
}

function run(command: string): void {
  postMessage<DesktopRendererMessage>({ type: 'desktop.run', command })
}

function isEditing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

// Keys VS Code users expect, minus the ones the native menu already binds.
function useShortcuts(openPalette: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'F1') {
        event.preventDefault()
        openPalette()
        return
      }
      const mod = event.metaKey || event.ctrlKey
      if (
        !mod ||
        isEditing(event.target) ||
        document.querySelector('.split, .cleanup')?.contains(event.target as Node)
      ) {
        return
      }
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault()
        run(event.shiftKey ? 'ukemi.redo' : 'ukemi.undo')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openPalette])
}

export function Shell() {
  const [layout, setLayout] = useState<Layout>(readLayout)
  const [panels, setPanels] = useState<SidePanels>({ bookmarks: [], workspaces: [] })
  const [detail, setDetail] = useState<ChangeDetail | null>(null)
  const [diff, setDiff] = useState<DiffDocument | null>(null)
  const [commands, setCommands] = useState<readonly PaletteCommand[]>([])
  const [isPaletteOpen, setIsPaletteOpen] = useState(false)
  const [platform, setPlatform] = useState('')
  const [repos, setRepos] = useState<readonly RepoSummary[]>([])
  const [activeRepoId, setActiveRepoId] = useState<string | null>(null)
  const [viewSettings, setViewSettings] = useState<ViewSettings>(DEFAULT_SETTINGS)
  const [tabs, setTabs] = useState<readonly PanelTab[]>([])
  const [activeTab, setActiveTab] = useState(CHANGE_TAB)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settingFields, setSettingFields] = useState<{ fields: SettingField[]; path: string }>({
    fields: [],
    path: '',
  })
  const [log, setLog] = useState<readonly LogLine[]>([])
  const [terminals, setTerminals] = useState<readonly TerminalTab[]>([])
  const [panelTab, setPanelTab] = useState(LOG_TAB)
  const [terminalFont, setTerminalFont] = useState<FontSpec>(DEFAULT_FONT)
  const [about, setAbout] = useState<{ info: AboutInfo; text: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const update = useCallback(
    (next: Partial<Layout> | ((current: Layout) => Partial<Layout>)) =>
      setLayout((current) => {
        const merged = { ...current, ...(typeof next === 'function' ? next(current) : next) }
        try {
          localStorage.setItem(LAYOUT_KEY, JSON.stringify(merged))
        } catch {
          // Layout is a convenience only.
        }
        return merged
      }),
    [],
  )

  const showTab = (id: string) => {
    setActiveTab(id)
    update({ showDetail: true })
  }

  useHostListener<DesktopHostMessage | HostMessage>((message) => {
    switch (message.type) {
      case 'state':
        setRepos(message.state.repos)
        setActiveRepoId(message.state.activeRepoId)
        setViewSettings(message.state.settings)
        setNow(Date.now())
        return
      case 'desktop.panels':
        setPanels(message.panels)
        return
      case 'desktop.detail':
        setDetail((previous) => {
          if (message.detail?.commit.changeId !== previous?.commit.changeId) {
            setDiff(null)
          }
          return message.detail
        })
        return
      case 'desktop.diff':
        setDiff(message.document)
        showTab(CHANGE_TAB)
        return
      case 'desktop.commands':
        setCommands(message.commands)
        return
      case 'desktop.window':
        setPlatform(message.platform)
        return
      case 'desktop.tabOpen':
        setTabs((all) => [...all, message.tab])
        showTab(message.tab.id)
        return
      case 'desktop.tabClose':
        setTabs((all) => all.filter((tab) => tab.id !== message.id))
        setActiveTab((current) => (current === message.id ? CHANGE_TAB : current))
        return
      case 'desktop.settings':
        setSettingFields({ fields: message.fields, path: message.path })
        return
      case 'desktop.terminalOpen':
        setTerminals((all) => [
          ...all,
          { id: message.id, title: message.title, cwd: message.cwd, hasExited: false },
        ])
        setPanelTab(message.id)
        update({ showPanel: true })
        return
      case 'desktop.terminalExit':
        setTerminals((all) => all.map((t) => (t.id === message.id ? { ...t, hasExited: true } : t)))
        return
      case 'desktop.about':
        setAbout({ info: message.info, text: message.text })
        return
      case 'desktop.fonts':
        applyEditorFont(message.fonts.editor)
        setTerminalFont(message.fonts.terminal)
        return
      case 'desktop.log':
        setLog((all) =>
          (message.replace ? message.lines : [...all, ...message.lines]).slice(-LOG_LIMIT),
        )
        return
      case 'desktop.action':
        switch (message.action) {
          case 'palette':
            setIsPaletteOpen(true)
            return
          case 'goTo':
            run('ukemi.goTo')
            return
          case 'toggleSidebar':
            update((current) => ({ showSidebar: !current.showSidebar }))
            return
          case 'toggleDetail':
            update((current) => ({ showDetail: !current.showDetail }))
            return
          case 'toggleLog':
            if (layout.showPanel && panelTab === LOG_TAB) {
              update({ showPanel: false })
            } else {
              setPanelTab(LOG_TAB)
              update({ showPanel: true })
            }
            return
          case 'showLog':
            setPanelTab(LOG_TAB)
            update({ showPanel: true })
            return
          case 'toggleTerminal':
            toggleTerminal()
            return
          case 'settings':
            setIsSettingsOpen(true)
            showTab(SETTINGS_TAB)
            return
        }
    }
  })

  // A tab whose view closed on its own, after Apply or Cancel, leaves the change tab showing.
  useEffect(() => {
    if (
      activeTab !== CHANGE_TAB &&
      activeTab !== SETTINGS_TAB &&
      !tabs.some((t) => t.id === activeTab)
    ) {
      setActiveTab(CHANGE_TAB)
    }
  }, [tabs, activeTab])

  // Shows the terminal, starting one when there is none. Hides the panel when a terminal shows.
  const toggleTerminal = () => {
    const isTerminalShown = layout.showPanel && terminals.some((t) => t.id === panelTab)
    if (isTerminalShown) {
      update({ showPanel: false })
      return
    }
    const last = terminals.at(-1)
    if (last) {
      setPanelTab(last.id)
      update({ showPanel: true })
    } else {
      postMessage<DesktopRendererMessage>({ type: 'desktop.terminalCreate' })
    }
  }

  const closeTerminal = (id: string) => {
    postMessage<DesktopRendererMessage>({ type: 'desktop.terminalClose', id })
    const rest = terminals.filter((t) => t.id !== id)
    setTerminals(rest)
    if (panelTab === id) {
      setPanelTab(rest.at(-1)?.id ?? LOG_TAB)
    }
  }

  const openPalette = useCallback(() => setIsPaletteOpen(true), [])
  const closeAbout = useCallback(() => setAbout(null), [])
  useShortcuts(openPalette)

  const columns = [
    layout.showSidebar ? `${layout.sidebar}px 1px` : '',
    'minmax(360px, 1fr)',
    layout.showDetail ? `1px ${layout.detail}px` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={`shell platform-${platform}`}
      style={{
        gridTemplateRows: layout.showPanel
          ? `var(--shell-titlebar) 1fr 1px ${layout.log}px`
          : undefined,
      }}
    >
      <header className="titlebar">
        <span className="wordmark" aria-label="Ukemi">
          ukemi
        </span>
        <RepoTabs repos={repos} activeRepoId={activeRepoId} />
        <button className="titlebar-search" onClick={openPalette} title="Run a command (F1)">
          <span className="codicon codicon-search" aria-hidden />
          <span>Run a command</span>
          <kbd>{platform === 'darwin' ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
        <button
          className={`icon-button${layout.showSidebar ? ' is-on' : ''}`}
          title="Toggle sidebar (Ctrl+B)"
          aria-pressed={layout.showSidebar}
          onClick={() => update({ showSidebar: !layout.showSidebar })}
        >
          <span className="codicon codicon-layout-sidebar-left" aria-hidden />
        </button>
        <button
          className={`icon-button${layout.showPanel ? ' is-on' : ''}`}
          title="Toggle panel: terminal and log"
          aria-pressed={layout.showPanel}
          onClick={() => update({ showPanel: !layout.showPanel })}
        >
          <span className="codicon codicon-layout-panel" aria-hidden />
        </button>
        <button
          className={`icon-button${layout.showDetail ? ' is-on' : ''}`}
          title="Toggle details (Ctrl+J)"
          aria-pressed={layout.showDetail}
          onClick={() => update({ showDetail: !layout.showDetail })}
        >
          <span className="codicon codicon-layout-sidebar-right" aria-hidden />
        </button>
        <button
          className="icon-button"
          title="More actions"
          onClick={(e) =>
            postMessage<DesktopRendererMessage>({
              type: 'desktop.titleMenu',
              x: e.currentTarget.getBoundingClientRect().left,
              y: e.currentTarget.getBoundingClientRect().bottom,
            })
          }
        >
          <span className="codicon codicon-ellipsis" aria-hidden />
        </button>
      </header>
      <main className="workspace" style={{ gridTemplateColumns: columns }}>
        {layout.showSidebar && (
          <>
            <Sidebar panels={panels} />
            <Splitter
              label="Resize sidebar"
              direction="columns"
              onDrag={(dx) => update((c) => ({ sidebar: Math.max(MIN_SIDEBAR, c.sidebar + dx) }))}
            />
          </>
        )}
        <div className="graph-pane">
          <App />
        </div>
        {layout.showDetail && (
          <>
            <Splitter
              label="Resize details"
              direction="columns"
              onDrag={(dx) => update((c) => ({ detail: Math.max(MIN_DETAIL, c.detail - dx) }))}
            />
            <RightPane
              tabs={tabs}
              active={activeTab}
              isSettingsOpen={isSettingsOpen}
              onActivate={setActiveTab}
              onCloseSettings={() => {
                setIsSettingsOpen(false)
                setActiveTab(CHANGE_TAB)
              }}
              change={
                <DetailPane
                  detail={detail}
                  diff={diff}
                  now={now}
                  settings={viewSettings}
                  onCloseDiff={() => setDiff(null)}
                />
              }
              settings={<SettingsView fields={settingFields.fields} path={settingFields.path} />}
            />
          </>
        )}
      </main>
      {layout.showPanel && (
        <Splitter
          label="Resize panel"
          direction="rows"
          onDrag={(dy) => update((c) => ({ log: Math.max(MIN_LOG, c.log - dy) }))}
        />
      )}
      {/* Kept mounted while hidden, so the shells and their scrollback survive. */}
      <div className="panel-slot" hidden={!layout.showPanel}>
        <BottomPanel
          terminals={terminals}
          active={panelTab}
          log={log}
          font={terminalFont}
          onActivate={setPanelTab}
          onCloseTerminal={closeTerminal}
          onHide={() => update({ showPanel: false })}
        />
      </div>
      {isPaletteOpen && <Palette commands={commands} onClose={() => setIsPaletteOpen(false)} />}
      {about && <AboutDialog info={about.info} text={about.text} onClose={closeAbout} />}
      <Dialogs />
    </div>
  )
}
