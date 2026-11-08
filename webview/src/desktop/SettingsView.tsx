import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { SettingField, SettingsRepository } from '../../../shared/desktopProtocol'
import { SaveContext, sendSettings, type Save } from './settingsSave'
import {
  currentValue,
  matchesQuery,
  readText,
  repositoryField,
  TEXT_FORMATS,
  type TextFieldType,
} from './settingsValues'
import { ShortcutsControl } from './ShortcutsControl'

export type SettingsScope = 'global' | 'repository'

// The setting of the keyboard shortcuts, which File > Keyboard Shortcuts scrolls to.
export const KEYBINDINGS_KEY = 'desktop.keybindings'

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

// A text control that saves when it loses focus or on Enter, after its check passes.
function TextControl({ field, type }: { field: SettingField; type: TextFieldType }) {
  const { multiline, toText } = TEXT_FORMATS[type]
  const shown = toText(currentValue(field))
  const [text, setText] = useState(shown)
  const [problem, setProblem] = useState<string | null>(null)
  const save = useContext(SaveContext)
  useEffect(() => setText(shown), [shown])

  const commit = () => {
    const outcome = readText(field, type, text)
    setProblem(outcome.kind === 'problem' ? outcome.problem : null)
    if (outcome.kind === 'reset') {
      save(field.key, undefined)
    } else if (outcome.kind === 'value') {
      save(field.key, outcome.value)
    }
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
          type={type === 'number' ? 'number' : 'text'}
          min={field.minimum}
          max={field.maximum}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      )}
      {problem && <p className="setting-problem">{problem}</p>}
    </>
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
            checked={currentValue(field) === true}
            onChange={(e) => save(field.key, e.target.checked)}
          />
          <span className="switch-track" aria-hidden />
          <span className="switch-label">{currentValue(field) === true ? 'On' : 'Off'}</span>
        </label>
      )
    case 'enum': {
      const selected = String(currentValue(field))
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
    case 'map':
    case 'number':
    case 'string':
      return <TextControl field={field} type={field.type} />
    case 'shortcuts':
      return <ShortcutsControl field={field} />
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
  useEffect(() => sendSettings({ type: 'desktop.loadSettings' }), [])
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
      sendSettings({
        type: 'desktop.setSetting',
        key,
        value,
        ...(repo ? { repoId: repo.id } : {}),
      }),
    [repo],
  )
  const visible = useMemo(
    () => shown.filter((f) => matchesQuery(f, query) && (!onlyModified || f.value !== undefined)),
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
            onClick={() => sendSettings({ type: 'desktop.openSettingsFile' })}
          >
            Open the file
          </button>
        </footer>
      </div>
    </SaveContext.Provider>
  )
}
