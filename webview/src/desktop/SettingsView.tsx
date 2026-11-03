import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  acceleratorOf,
  formatAccelerator,
  normalizeAccelerator,
} from '../../../shared/accelerators'
import type {
  DesktopRendererMessage,
  SettingField,
  SettingsRepository,
  ShortcutField,
} from '../../../shared/desktopProtocol'
import { postMessage } from '../shared/hostApi'

export type SettingsScope = 'global' | 'repository'

// The setting of the keyboard shortcuts, which File > Keyboard Shortcuts scrolls to.
export const KEYBINDINGS_KEY = 'desktop.keybindings'

const PLATFORM = /Mac/.test(navigator.platform) ? 'darwin' : navigator.platform

type Save = (key: string, value: unknown) => void

function send(message: DesktopRendererMessage): void {
  postMessage(message)
}

// Writes the global value, or the override of the repository the form shows.
const SaveContext = createContext<Save>((key, value) =>
  send({ type: 'desktop.setSetting', key, value }),
)

// In the repository mode a field shows the override, with the global value as its fallback.
function repositoryField(field: SettingField, repository: SettingsRepository): SettingField {
  const inherited = field.value === undefined ? field.default : field.value
  return { ...field, value: repository.values[field.key], default: inherited }
}

// Shows `code` from the package.json descriptions as code.
function Description({ text }: { text: string }) {
  const parts = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').split(/(`[^`]+`)/g)
  return (
    <p className="setting-description">
      {parts.map((part, index) =>
        part.startsWith('`') && part.endsWith('`') ? (
          <code key={index}>{part.slice(1, -1)}</code>
        ) : (
          part
        ),
      )}
    </p>
  )
}

function current(field: SettingField): unknown {
  return field.value === undefined ? field.default : field.value
}

function listText(value: unknown): string {
  return Array.isArray(value) ? value.join('\n') : ''
}

function mapText(value: unknown): string {
  return typeof value === 'object' && value !== null
    ? Object.entries(value)
        .map(([key, item]) => `${key} = ${String(item)}`)
        .join('\n')
    : ''
}

function parseList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseMap(text: string): Record<string, string> | string {
  const entries: Array<[string, string]> = []
  for (const line of text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)) {
    const at = line.indexOf('=')
    if (at <= 0) {
      return `Write each line as "host = value": ${line}`
    }
    entries.push([line.slice(0, at).trim(), line.slice(at + 1).trim()])
  }
  return Object.fromEntries(entries)
}

// A text control that saves when it loses focus or on Enter, after its check passes.
function TextControl({
  field,
  multiline,
  toText,
  fromText,
}: {
  field: SettingField
  multiline: boolean
  toText: (value: unknown) => string
  fromText: (text: string) => unknown
}) {
  const shown = toText(current(field))
  const [text, setText] = useState(shown)
  const [problem, setProblem] = useState<string | null>(null)
  const save = useContext(SaveContext)
  useEffect(() => setText(shown), [shown])

  const commit = () => {
    if (text === shown) {
      setProblem(null)
      return
    }
    // An empty field goes back to the default.
    if (text.trim() === '' && (field.type === 'number' || field.type === 'string')) {
      setProblem(null)
      save(field.key, undefined)
      return
    }
    const value = fromText(text)
    if (typeof value === 'string' && field.type === 'map') {
      setProblem(value)
      return
    }
    if (field.pattern && typeof value === 'string' && !new RegExp(field.pattern).test(value)) {
      setProblem(field.patternMessage ?? 'This value has the wrong format.')
      return
    }
    if (field.type === 'number') {
      const number = value as number
      if (
        !Number.isFinite(number) ||
        (field.minimum !== undefined && number < field.minimum) ||
        (field.maximum !== undefined && number > field.maximum)
      ) {
        setProblem(`Enter a number from ${field.minimum ?? '…'} to ${field.maximum ?? '…'}.`)
        return
      }
    }
    setProblem(null)
    save(field.key, value)
  }

  const common = {
    className: `setting-input${problem ? ' has-problem' : ''}`,
    value: text,
    spellCheck: false,
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onBlur: commit,
  }
  return (
    <>
      {multiline ? (
        <textarea {...common} rows={Math.min(8, Math.max(3, text.split('\n').length + 1))} />
      ) : (
        <input
          {...common}
          type={field.type === 'number' ? 'number' : 'text'}
          min={field.minimum}
          max={field.maximum}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      )}
      {problem && <p className="setting-problem">{problem}</p>}
    </>
  )
}

function ownKeys(value: unknown): Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {}
}

function recordShortcut(isRecording: boolean): void {
  send({ type: 'desktop.recordShortcut', isRecording })
}

interface ShortcutRowProps {
  action: ShortcutField
  shortcut: string
  isOwn: boolean
  // The other commands with the same keys.
  clashes: string[]
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
function ShortcutsControl({ field }: { field: SettingField }) {
  const save = useContext(SaveContext)
  const own = ownKeys(field.value)
  const actions = field.shortcuts ?? []
  const keyOf = (action: ShortcutField) => own[action.id] ?? action.default
  const byKey = new Map<string, string[]>()
  for (const action of actions) {
    const normal = normalizeAccelerator(keyOf(action), PLATFORM)
    if (normal) {
      byKey.set(normal, [...(byKey.get(normal) ?? []), action.title])
    }
  }
  const store = (next: Record<string, string>) =>
    save(field.key, Object.keys(next).length > 0 ? next : undefined)
  const without = (id: string) => Object.fromEntries(Object.entries(own).filter(([k]) => k !== id))
  const set = (action: ShortcutField, key: string) =>
    store(key === action.default ? without(action.id) : { ...without(action.id), [action.id]: key })
  const menus = [...new Set(actions.map((action) => action.menu))]
  return (
    <div className="shortcuts">
      {menus.map((menu) => (
        <table key={menu} className="shortcut-table">
          <caption>{menu}</caption>
          <tbody>
            {actions
              .filter((action) => action.menu === menu)
              .map((action) => {
                const shortcut = keyOf(action)
                const normal = normalizeAccelerator(shortcut, PLATFORM)
                const clashes = normal
                  ? (byKey.get(normal) ?? []).filter((title) => title !== action.title)
                  : []
                return (
                  <ShortcutRow
                    key={action.id}
                    action={action}
                    shortcut={shortcut}
                    isOwn={action.id in own}
                    clashes={clashes}
                    onSet={(key) => set(action, key)}
                    onReset={() => store(without(action.id))}
                  />
                )
              })}
          </tbody>
        </table>
      ))}
    </div>
  )
}

function Control({ field }: { field: SettingField }) {
  const save = useContext(SaveContext)
  switch (field.type) {
    case 'boolean':
      return (
        <label className="switch">
          <input
            type="checkbox"
            checked={current(field) === true}
            onChange={(e) => save(field.key, e.target.checked)}
          />
          <span className="switch-track" aria-hidden />
          <span className="switch-label">{current(field) === true ? 'On' : 'Off'}</span>
        </label>
      )
    case 'enum': {
      const selected = String(current(field))
      const option = field.options?.find((o) => o.value === selected)
      return (
        <>
          <select
            className="setting-input setting-select"
            value={selected}
            onChange={(e) => save(field.key, e.target.value)}
          >
            {field.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value}
              </option>
            ))}
          </select>
          {option?.description && <p className="setting-hint">{option.description}</p>}
        </>
      )
    }
    case 'list':
      return <TextControl field={field} multiline toText={listText} fromText={parseList} />
    case 'map':
      return <TextControl field={field} multiline toText={mapText} fromText={parseMap} />
    case 'shortcuts':
      return <ShortcutsControl field={field} />
    case 'number':
      return (
        <TextControl
          field={field}
          multiline={false}
          toText={(v) => String(v ?? '')}
          fromText={Number}
        />
      )
    case 'string':
      return (
        <TextControl
          field={field}
          multiline={false}
          toText={(v) => String(v ?? '')}
          fromText={(t) => t.trim()}
        />
      )
  }
}

function Field({ field, scope }: { field: SettingField; scope: SettingsScope }) {
  const save = useContext(SaveContext)
  const isModified = field.value !== undefined
  const isRepository = scope === 'repository'
  return (
    <div className={`setting${isModified ? ' is-modified' : ''}`} id={`setting-${field.key}`}>
      <div className="setting-head">
        <h3 className="setting-title">{field.title}</h3>
        {isRepository && (
          <span className={`setting-scope${isModified ? ' is-own' : ''}`}>
            {isModified ? 'Set for this repository' : 'Same as all repositories'}
          </span>
        )}
        {isModified && (
          <button
            className="link-button"
            title={`${isRepository ? 'Use the value of all repositories' : 'Reset to'} ${JSON.stringify(field.default)}`}
            onClick={() => save(field.key, undefined)}
          >
            {isRepository ? 'Use the value for all' : 'Reset'}
          </button>
        )}
      </div>
      <Description text={field.description} />
      {!isRepository && field.overriddenIn.length > 0 && (
        <p className="setting-hint setting-overridden">
          <span className="codicon codicon-repo" aria-hidden /> Set differently in{' '}
          {field.overriddenIn.join(', ')}
        </p>
      )}
      <div className="setting-control">
        <Control field={field} />
      </div>
      <p className="setting-key">ukemi.{field.key}</p>
    </div>
  )
}

function matches(field: SettingField, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return (
    !needle ||
    `${field.title} ${field.key} ${field.description} ${(field.shortcuts ?? []).map((s) => s.title).join(' ')}`
      .toLowerCase()
      .includes(needle)
  )
}

interface SettingsViewProps {
  fields: readonly SettingField[]
  path: string
  repository: SettingsRepository | null
  scope: SettingsScope
  // The setting to scroll to. A new object scrolls again.
  focus?: { key: string } | null
  onScope: (scope: SettingsScope) => void
}

function ScopeSwitch({
  repository,
  scope,
  onScope,
}: Pick<SettingsViewProps, 'repository' | 'scope' | 'onScope'>) {
  const option = (value: SettingsScope, label: ReactNode, isDisabled = false) => (
    <button
      role="radio"
      aria-checked={scope === value}
      className={`scope-option${scope === value ? ' is-active' : ''}`}
      disabled={isDisabled}
      onClick={() => onScope(value)}
    >
      {label}
    </button>
  )
  return (
    <div className="scope-switch" role="radiogroup" aria-label="Which settings to edit">
      {option('global', 'All repositories')}
      {option(
        'repository',
        <>
          <span className="codicon codicon-repo" aria-hidden />
          {repository ? repository.label : 'This repository'}
        </>,
        repository === null,
      )}
    </div>
  )
}

// The `ukemi.*` settings as a form. Changes save to settings.json right away. In the
// repository mode the form edits the overrides of the active repository.
export function SettingsView({
  fields,
  path,
  repository,
  scope,
  focus = null,
  onScope,
}: SettingsViewProps): ReactNode {
  const [query, setQuery] = useState('')
  const [onlyModified, setOnlyModified] = useState(false)
  const hasFields = fields.length > 0
  useEffect(() => {
    if (!focus || !hasFields) {
      return
    }
    setQuery('')
    setOnlyModified(false)
    // After the filters clear, so the setting is in the form.
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`setting-${focus.key}`)
      // Clear of the sticky header, so the title of the setting shows.
      const header = document.querySelector<HTMLElement>('.settings-header')
      target?.style.setProperty('scroll-margin-top', `${(header?.offsetHeight ?? 0) + 8}px`)
      target?.scrollIntoView({ block: 'start' })
    })
    return () => cancelAnimationFrame(frame)
  }, [focus, hasFields])
  useEffect(() => send({ type: 'desktop.loadSettings' }), [])
  // Without a repository, the form falls back to the settings of all repositories.
  const repo = scope === 'repository' ? repository : null
  const shownScope: SettingsScope = repo ? 'repository' : 'global'
  const shown = useMemo(
    () =>
      repo
        ? fields.filter((f) => f.isRepositoryScoped).map((f) => repositoryField(f, repo))
        : fields,
    [fields, repo],
  )
  const save = useMemo<Save>(
    () => (key, value) =>
      send({ type: 'desktop.setSetting', key, value, ...(repo ? { repoId: repo.id } : {}) }),
    [repo],
  )
  const visible = useMemo(
    () => shown.filter((f) => matches(f, query) && (!onlyModified || f.value !== undefined)),
    [shown, query, onlyModified],
  )
  const groups = [...new Set(visible.map((f) => f.group))]
  const modified = shown.filter((f) => f.value !== undefined).length
  return (
    <SaveContext.Provider value={save}>
      <div className={`settings${repo ? ' is-repository' : ''}`}>
        <header className="settings-header">
          <div className="settings-title">
            <h1>Settings</h1>
            <ScopeSwitch repository={repository} scope={shownScope} onScope={onScope} />
          </div>
          {repo && (
            <p className="settings-scope-note">
              These settings apply to <strong title={repo.id}>{repo.label}</strong> only. The others
              apply to all repositories.
            </p>
          )}
          <div className="settings-tools">
            <div className="side-filter settings-search">
              <span className="codicon codicon-search" aria-hidden />
              <input
                value={query}
                placeholder="Search settings"
                spellCheck={false}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <button
              className={`button-quiet${onlyModified ? ' is-on' : ''}`}
              aria-pressed={onlyModified}
              onClick={() => setOnlyModified((v) => !v)}
            >
              Modified <span className="detail-count">{modified}</span>
            </button>
          </div>
        </header>
        {groups.map((group) => (
          <section key={group} className="settings-group">
            <h2>{group}</h2>
            {visible
              .filter((f) => f.group === group)
              .map((field) => (
                <Field key={field.key} field={field} scope={repo ? 'repository' : 'global'} />
              ))}
          </section>
        ))}
        {visible.length === 0 && <p className="side-empty">No settings match.</p>}
        <footer className="settings-footer">
          <span title={path}>
            {repo ? 'Stored under "repositories" in settings.json' : 'Stored in settings.json'}
          </span>
          <button
            className="link-button"
            onClick={() => send({ type: 'desktop.openSettingsFile' })}
          >
            Open the file
          </button>
        </footer>
      </div>
    </SaveContext.Provider>
  )
}
