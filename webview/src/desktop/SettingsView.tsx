import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  DesktopRendererMessage,
  SettingField,
  SettingsRepository,
} from '../../../shared/desktopProtocol'
import { postMessage } from '../shared/hostApi'

export type SettingsScope = 'global' | 'repository'

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
    !needle || `${field.title} ${field.key} ${field.description}`.toLowerCase().includes(needle)
  )
}

interface SettingsViewProps {
  fields: readonly SettingField[]
  path: string
  repository: SettingsRepository | null
  scope: SettingsScope
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
  onScope,
}: SettingsViewProps): ReactNode {
  const [query, setQuery] = useState('')
  const [onlyModified, setOnlyModified] = useState(false)
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
