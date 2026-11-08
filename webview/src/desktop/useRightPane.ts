import { useEffect, useState } from 'react'
import type { PanelTab, ShellAction } from '../../../shared/desktopProtocol'
import { CHANGE_TAB, SETTINGS_TAB } from './RightPane'
import { KEYBINDINGS_KEY, type SettingsScope } from './SettingsView'
import { activeAfterClose, withoutTab, withTab } from './shellState'
import type { UpdateLayout } from './useLayout'

export type SettingsAction = Extract<
  ShellAction,
  'settings' | 'repositorySettings' | 'keyboardShortcuts'
>

// The right pane: the change, the settings form, and the Split or Clean up tabs.
export function useRightPane(update: UpdateLayout) {
  const [tabs, setTabs] = useState<readonly PanelTab[]>([])
  const [activeTab, setActiveTab] = useState(CHANGE_TAB)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settingsScope, setSettingsScope] = useState<SettingsScope>('global')
  // The setting to scroll to, as File > Keyboard Shortcuts asks. A new object asks again.
  const [settingsFocus, setSettingsFocus] = useState<{ key: string } | null>(null)

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

  const showTab = (id: string) => {
    setActiveTab(id)
    update({ showDetail: true })
  }

  return {
    tabs,
    activeTab,
    setActiveTab,
    isSettingsOpen,
    settingsScope,
    setSettingsScope,
    settingsFocus,
    showTab,
    tabOpened: (tab: PanelTab) => {
      setTabs((all) => withTab(all, tab))
      showTab(tab.id)
    },
    tabClosed: (id: string) => {
      setTabs((all) => withoutTab(all, id))
      setActiveTab((current) => activeAfterClose(current, id, CHANGE_TAB))
    },
    openSettings: (action: SettingsAction) => {
      setSettingsScope(action === 'repositorySettings' ? 'repository' : 'global')
      if (action === 'keyboardShortcuts') {
        setSettingsFocus({ key: KEYBINDINGS_KEY })
      }
      setIsSettingsOpen(true)
      showTab(SETTINGS_TAB)
    },
    closeSettings: () => {
      setIsSettingsOpen(false)
      setActiveTab(CHANGE_TAB)
    },
  }
}
