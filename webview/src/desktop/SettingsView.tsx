import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DesktopRendererMessage, SettingField } from '../../../shared/desktopProtocol'
import { postMessage } from '../shared/hostApi'

function send(message: DesktopRendererMessage): void {
  postMessage(message)
}

function save(key: string, value: unknown): void {
  send({ type: 'desktop.setSetting', key, value })
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

function Field({ field }: { field: SettingField }) {
  const isModified = field.value !== undefined
  return (
    <div className={`setting${isModified ? ' is-modified' : ''}`} id={`setting-${field.key}`}>
      <div className="setting-head">
        <h3 className="setting-title">{field.title}</h3>
        {isModified && (
          <button
            className="link-button"
            title={`Reset to ${JSON.stringify(field.default)}`}
            onClick={() => save(field.key, undefined)}
          >
            Reset
          </button>
        )}
      </div>
      <Description text={field.description} />
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

// The `ukemi.*` settings as a form. Changes save to settings.json right away.
export function SettingsView({
  fields,
  path,
}: {
  fields: readonly SettingField[]
  path: string
}): ReactNode {
  const [query, setQuery] = useState('')
  const [onlyModified, setOnlyModified] = useState(false)
  useEffect(() => send({ type: 'desktop.loadSettings' }), [])
  const visible = useMemo(
    () => fields.filter((f) => matches(f, query) && (!onlyModified || f.value !== undefined)),
    [fields, query, onlyModified],
  )
  const groups = [...new Set(visible.map((f) => f.group))]
  const modified = fields.filter((f) => f.value !== undefined).length
  return (
    <div className="settings">
      <header className="settings-header">
        <h1>Settings</h1>
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
              <Field key={field.key} field={field} />
            ))}
        </section>
      ))}
      {visible.length === 0 && <p className="side-empty">No settings match.</p>}
      <footer className="settings-footer">
        <span title={path}>Stored in settings.json</span>
        <button className="link-button" onClick={() => send({ type: 'desktop.openSettingsFile' })}>
          Open the file
        </button>
      </footer>
    </div>
  )
}
