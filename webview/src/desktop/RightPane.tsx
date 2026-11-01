import { useMemo, type ReactNode } from 'react'
import type { DesktopRendererMessage, PanelTab } from '../../../shared/desktopProtocol'
import { CleanupApp } from '../cleanup/CleanupApp'
import { dirtyTabs } from '../editor/dirtyTabs'
import { EditorApp } from '../editor/EditorApp'
import { postMessage } from '../shared/hostApi'
import { HostChannelContext, windowChannel, type HostChannel } from '../shared/hostChannel'
import { SplitApp } from '../split/SplitApp'

export const CHANGE_TAB = 'change'
export const SETTINGS_TAB = 'settings'

function isPanelMessage(value: unknown, id: string): value is { message: unknown } {
  const message = value as { type?: unknown; panelId?: unknown }
  return message?.type === 'desktop.panel' && message.panelId === id
}

// A tab's own channel: its messages travel wrapped with the tab id over the window's channel.
function tabChannel(id: string): HostChannel {
  return {
    post: (message) =>
      postMessage<DesktopRendererMessage>({ type: 'desktop.panel', panelId: id, message }),
    subscribe: (listener) =>
      windowChannel.subscribe((message) => {
        if (isPanelMessage(message, id)) {
          listener(message.message)
        }
      }),
  }
}

function PanelView({ tab }: { tab: PanelTab }) {
  const channel = useMemo(() => tabChannel(tab.id), [tab.id])
  return (
    <HostChannelContext.Provider value={channel}>
      {tab.kind === 'split' ? (
        <SplitApp />
      ) : tab.kind === 'editor' ? (
        <EditorApp tabId={tab.id} />
      ) : (
        <CleanupApp />
      )}
    </HostChannelContext.Provider>
  )
}

const ICONS: Record<PanelTab['kind'], string> = {
  split: 'split-horizontal',
  cleanup: 'sparkle',
  editor: 'edit',
}

// An editor tab decides itself, so it can ask before dropping unsaved edits.
function closeTab(tab: PanelTab): void {
  if (tab.kind === 'editor') {
    tabChannel(tab.id).post({ type: 'close', isDirty: dirtyTabs.has(tab.id) })
    return
  }
  postMessage<DesktopRendererMessage>({ type: 'desktop.tabClosed', id: tab.id })
}

interface TabButton {
  id: string
  title: string
  icon: string
  onClose?: () => void
}

// The right side of the window: the selected change, and views opened beside it as tabs.
export function RightPane({
  tabs,
  active,
  isSettingsOpen,
  onActivate,
  onCloseSettings,
  change,
  settings,
}: {
  tabs: readonly PanelTab[]
  active: string
  isSettingsOpen: boolean
  onActivate: (id: string) => void
  onCloseSettings: () => void
  change: ReactNode
  settings: ReactNode
}) {
  const buttons: TabButton[] = [
    { id: CHANGE_TAB, title: 'Change', icon: 'git-commit' },
    ...tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      icon: ICONS[tab.kind],
      onClose: () => closeTab(tab),
    })),
    ...(isSettingsOpen
      ? [{ id: SETTINGS_TAB, title: 'Settings', icon: 'settings-gear', onClose: onCloseSettings }]
      : []),
  ]
  return (
    <section className="right-pane">
      <div className="pane-tabs" role="tablist">
        {buttons.map((button) => (
          <div
            key={button.id}
            role="tab"
            aria-selected={button.id === active}
            className={`pane-tab${button.id === active ? ' is-active' : ''}`}
            onClick={() => onActivate(button.id)}
            onAuxClick={(e) => e.button === 1 && button.onClose?.()}
          >
            <span className={`codicon codicon-${button.icon}`} aria-hidden />
            <span className="pane-tab-label">{button.title}</span>
            {button.onClose && (
              <button
                className="repo-tab-close"
                aria-label={`Close ${button.title}`}
                onClick={(e) => {
                  e.stopPropagation()
                  button.onClose?.()
                }}
              >
                <span className="codicon codicon-close" aria-hidden />
              </button>
            )}
          </div>
        ))}
      </div>
      {/* Every tab stays mounted, so switching keeps a half-done split or clean-up. */}
      <div className="pane-body" hidden={active !== CHANGE_TAB}>
        {change}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} className="pane-body pane-scroll" hidden={active !== tab.id}>
          <PanelView tab={tab} />
        </div>
      ))}
      {isSettingsOpen && (
        <div className="pane-body pane-scroll" hidden={active !== SETTINGS_TAB}>
          {settings}
        </div>
      )}
    </section>
  )
}
