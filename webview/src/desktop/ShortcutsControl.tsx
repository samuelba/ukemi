import { useContext, useEffect, useState, type KeyboardEvent } from 'react'
import { acceleratorOf, formatAccelerator } from '../../../shared/accelerators'
import type { SettingField, ShortcutField } from '../../../shared/desktopProtocol'
import { SaveContext, sendSettings } from './settingsSave'
import { ownShortcuts, shortcutClashes, shortcutOf, withShortcut } from './settingsValues'

const PLATFORM = /Mac/.test(navigator.platform) ? 'darwin' : navigator.platform

function recordShortcut(isRecording: boolean): void {
  sendSettings({ type: 'desktop.recordShortcut', isRecording })
}

interface ShortcutRowProps {
  action: ShortcutField
  shortcut: string
  isOwn: boolean
  // The other commands with the same keys.
  clashes: readonly string[]
  onSet: (key: string) => void
  onReset: () => void
}

// One command with its keys. Clicking the keys records new ones: the next key press with a
// modifier, or a function key. Escape cancels.
function ShortcutRow({ action, shortcut, isOwn, clashes, onSet, onReset }: ShortcutRowProps) {
  const [isRecording, setIsRecording] = useState(false)
  useEffect(() => {
    if (!isRecording) {
      return
    }
    recordShortcut(true)
    return () => recordShortcut(false)
  }, [isRecording])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!isRecording) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const hasModifier = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
    if (event.key === 'Escape' && !hasModifier) {
      setIsRecording(false)
      return
    }
    const key = acceleratorOf(event, PLATFORM)
    if (key) {
      setIsRecording(false)
      onSet(key)
    }
  }

  return (
    <tr className={`shortcut${clashes.length > 0 ? ' has-clash' : ''}`}>
      <th scope="row" className="shortcut-title">
        {action.title}
      </th>
      <td className="shortcut-keys">
        <button
          className={`shortcut-key${isRecording ? ' is-recording' : ''}${shortcut ? '' : ' is-empty'}`}
          title={isRecording ? 'Press the new keys, or Escape to cancel' : 'Change the shortcut'}
          aria-label={`Shortcut of ${action.title}: ${shortcut ? formatAccelerator(shortcut, PLATFORM) : 'none'}`}
          onClick={() => setIsRecording(true)}
          onKeyDown={onKeyDown}
          onBlur={() => setIsRecording(false)}
        >
          {isRecording ? (
            'Press keys…'
          ) : shortcut ? (
            <kbd>{formatAccelerator(shortcut, PLATFORM)}</kbd>
          ) : (
            'None'
          )}
        </button>
        {clashes.length > 0 && (
          <p className="setting-problem shortcut-clash">Also {clashes.join(', ')}</p>
        )}
      </td>
      <td className="shortcut-tools">
        {shortcut && (
          <button
            className="icon-button"
            title="Remove the shortcut"
            aria-label={`Remove the shortcut of ${action.title}`}
            onClick={() => onSet('')}
          >
            <span className="codicon codicon-close" aria-hidden />
          </button>
        )}
        {isOwn && (
          <button
            className="icon-button"
            title={`Reset to ${action.default ? formatAccelerator(action.default, PLATFORM) : 'none'}`}
            aria-label={`Reset the shortcut of ${action.title}`}
            onClick={onReset}
          >
            <span className="codicon codicon-discard" aria-hidden />
          </button>
        )}
      </td>
    </tr>
  )
}

// The keyboard shortcuts of the menu commands, by menu. The setting keeps only the ones the
// user changed.
export function ShortcutsControl({ field }: { field: SettingField }) {
  const save = useContext(SaveContext)
  const own = ownShortcuts(field.value)
  const actions = field.shortcuts ?? []
  const clashes = shortcutClashes(actions, own, PLATFORM)
  const store = (action: ShortcutField, key: string | null) => {
    const next = withShortcut(own, action, key)
    save(field.key, Object.keys(next).length > 0 ? next : undefined)
  }
  const menus = [...new Set(actions.map((action) => action.menu))]
  return (
    <div className="shortcuts">
      {menus.map((menu) => (
        <table key={menu} className="shortcut-table">
          <caption>{menu}</caption>
          <tbody>
            {actions
              .filter((action) => action.menu === menu)
              .map((action) => (
                <ShortcutRow
                  key={action.id}
                  action={action}
                  shortcut={shortcutOf(action, own)}
                  isOwn={action.id in own}
                  clashes={clashes.get(action.id) ?? []}
                  onSet={(key) => store(action, key)}
                  onReset={() => store(action, null)}
                />
              ))}
          </tbody>
        </table>
      ))}
    </div>
  )
}
