import { useCallback, useState } from 'react'
import type {
  AboutInfo,
  DesktopHostMessage,
  FontSpec,
  PaletteCommand,
  SettingField,
  SettingsRepository,
  SidePanels,
} from '../../../shared/desktopProtocol'
import type { HostMessage, ViewSettings, ViewState } from '../../../shared/protocol'
import { App } from '../graph/App'
import { FileIconFonts, FileIconThemeContext } from '../graph/FileIcon'
import { useHostListener } from '../shared/hooks'
import { DetailPane } from './DetailPane'
import { Dialogs } from './Dialogs'
import { useBundledFileIcons } from './fileIcons'
import { AboutDialog } from './AboutDialog'
import { BottomPanel } from './BottomPanel'
import { Palette } from './Palette'
import { CHANGE_TAB, RightPane } from './RightPane'
import { SettingsView } from './SettingsView'
import { withDetail, type DetailPane as DetailPaneState } from './shellState'
import { Sidebar } from './Sidebar'
import { Splitter } from './Splitter'
import { StatusBar } from './StatusBar'
import { Titlebar } from './Titlebar'
import { useBottomPanel } from './useBottomPanel'
import {
  MIN_DETAIL,
  MIN_LOG,
  MIN_SIDEBAR,
  shellRows,
  useLayout,
  workspaceColumns,
} from './useLayout'
import { useRightPane } from './useRightPane'
import { applyEditorFont, run, useFolderDrop, useShortcuts, useWheelZoom } from './windowInput'

const DEFAULT_SETTINGS: ViewSettings = {
  changeIdLength: 4,
  showFullPaths: false,
  showLineStats: false,
  showGitTags: true,
  previewDrops: true,
  changedFilesView: 'list',
  ciOnlyMine: true,
}

const DEFAULT_FONT: FontSpec = { family: 'monospace', size: 13, weight: 'normal' }

const NO_PANELS: SidePanels = { bookmarks: [], workspaces: [], operations: [] }

interface SettingsForm {
  fields: SettingField[]
  path: string
  repository: SettingsRepository | null
}

export function Shell() {
  const fileIcons = useBundledFileIcons()
  const [layout, update] = useLayout()
  const bottom = useBottomPanel(layout, update)
  const right = useRightPane(update)
  const [viewState, setViewState] = useState<ViewState | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [panels, setPanels] = useState<SidePanels>(NO_PANELS)
  const [pane, setPane] = useState<DetailPaneState>({ detail: null, diff: null })
  const [commands, setCommands] = useState<readonly PaletteCommand[]>([])
  const [isPaletteOpen, setIsPaletteOpen] = useState(false)
  const [platform, setPlatform] = useState('')
  const [settingsForm, setSettingsForm] = useState<SettingsForm>({
    fields: [],
    path: '',
    repository: null,
  })
  const [terminalFont, setTerminalFont] = useState<FontSpec>(DEFAULT_FONT)
  const [about, setAbout] = useState<{ info: AboutInfo; text: string } | null>(null)
  const [zoomPercent, setZoomPercent] = useState(100)

  useHostListener<DesktopHostMessage | HostMessage>((message) => {
    switch (message.type) {
      case 'state':
        setViewState(message.state)
        setNow(Date.now())
        return
      case 'desktop.panels':
        setPanels(message.panels)
        return
      case 'desktop.detail':
        setPane((current) => withDetail(current, message.detail))
        return
      case 'desktop.diff':
        setPane((current) => ({ ...current, diff: message.document }))
        right.showTab(CHANGE_TAB)
        return
      case 'desktop.commands':
        setCommands(message.commands)
        return
      case 'desktop.window':
        setPlatform(message.platform)
        return
      case 'desktop.tabOpen':
        right.tabOpened(message.tab)
        return
      case 'desktop.tabClose':
        right.tabClosed(message.id)
        return
      case 'desktop.settings':
        setSettingsForm({
          fields: message.fields,
          path: message.path,
          repository: message.repository,
        })
        return
      case 'desktop.terminalOpen':
        bottom.terminalOpened({ id: message.id, title: message.title, cwd: message.cwd })
        return
      case 'desktop.terminalExit':
        bottom.terminalExited(message.id)
        return
      case 'desktop.about':
        setAbout({ info: message.info, text: message.text })
        return
      case 'desktop.fonts':
        applyEditorFont(message.fonts.editor)
        setTerminalFont(message.fonts.terminal)
        return
      case 'desktop.zoom':
        setZoomPercent(message.percent)
        return
      case 'desktop.log':
        bottom.addLog(message.lines, message.replace)
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
            bottom.toggleLog()
            return
          case 'showLog':
            bottom.showLog()
            return
          case 'toggleTerminal':
            bottom.toggleTerminal()
            return
          case 'settings':
          case 'repositorySettings':
          case 'keyboardShortcuts':
            right.openSettings(message.action)
            return
        }
    }
  })

  const openPalette = useCallback(() => setIsPaletteOpen(true), [])
  const closeAbout = useCallback(() => setAbout(null), [])
  useShortcuts(openPalette)
  useWheelZoom()
  const isDropping = useFolderDrop()

  return (
    <FileIconThemeContext.Provider value={fileIcons}>
      <FileIconFonts theme={fileIcons} />
      <div className={`shell platform-${platform}`} style={{ gridTemplateRows: shellRows(layout) }}>
        <Titlebar
          repos={viewState?.repos ?? []}
          activeRepoId={viewState?.activeRepoId ?? null}
          platform={platform}
          layout={layout}
          update={update}
          onOpenPalette={openPalette}
        />
        <main className="workspace" style={{ gridTemplateColumns: workspaceColumns(layout) }}>
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
                tabs={right.tabs}
                active={right.activeTab}
                isSettingsOpen={right.isSettingsOpen}
                onActivate={right.setActiveTab}
                onCloseSettings={right.closeSettings}
                change={
                  <DetailPane
                    detail={pane.detail}
                    diff={pane.diff}
                    now={now}
                    settings={viewState?.settings ?? DEFAULT_SETTINGS}
                    onCloseDiff={() => setPane((current) => ({ ...current, diff: null }))}
                  />
                }
                settings={
                  <SettingsView
                    {...settingsForm}
                    scope={right.settingsScope}
                    focus={right.settingsFocus}
                    onScope={right.setSettingsScope}
                  />
                }
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
            terminals={bottom.terminals}
            active={bottom.panelTab}
            log={bottom.log}
            font={terminalFont}
            onActivate={bottom.setPanelTab}
            onCloseTerminal={bottom.closeTerminal}
            onHide={() => update({ showPanel: false })}
          />
        </div>
        <StatusBar state={viewState} zoomPercent={zoomPercent} onShowLog={bottom.showLog} />
        {isPaletteOpen && <Palette commands={commands} onClose={() => setIsPaletteOpen(false)} />}
        {about && <AboutDialog info={about.info} text={about.text} onClose={closeAbout} />}
        <Dialogs />
        {isDropping && (
          <div className="folder-drop" aria-hidden="true">
            <div className="folder-drop-hint">
              <i className="codicon codicon-folder-opened" />
              Drop a folder to open it
            </div>
          </div>
        )}
      </div>
    </FileIconThemeContext.Provider>
  )
}
