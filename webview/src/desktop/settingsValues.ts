import { normalizeAccelerator } from '../../../shared/accelerators'
import type {
  SettingField,
  SettingsRepository,
  ShortcutField,
} from '../../../shared/desktopProtocol'

// The pure side of the settings form: how values show as text, how text becomes a value again,
// and which fields a search or a shortcut clash finds.

export type TextFieldType = Extract<SettingField['type'], 'list' | 'map' | 'number' | 'string'>

export interface TextFormat {
  multiline: boolean
  toText: (value: unknown) => string
  // A string from a map is the problem with the text.
  fromText: (text: string) => unknown
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

// The descriptions show maps as settings.json writes them, so pasted JSON reads too.
function parseJsonMap(text: string): Record<string, string> | string {
  const problem =
    'Write a JSON object of strings, like { "name": "value" }, or one "name = value" per line.'
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return problem
  }
  const isStringMap =
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  return isStringMap ? (value as Record<string, string>) : problem
}

function parseMap(text: string): Record<string, string> | string {
  if (text.trim().startsWith('{')) {
    return parseJsonMap(text)
  }
  const entries: Array<[string, string]> = []
  for (const line of parseList(text)) {
    const at = line.indexOf('=')
    if (at <= 0) {
      return `Write each line as "name = value": ${line}`
    }
    entries.push([line.slice(0, at).trim(), line.slice(at + 1).trim()])
  }
  return Object.fromEntries(entries)
}

export const TEXT_FORMATS: Record<TextFieldType, TextFormat> = {
  list: { multiline: true, toText: listText, fromText: parseList },
  map: { multiline: true, toText: mapText, fromText: parseMap },
  number: { multiline: false, toText: (v) => String(v ?? ''), fromText: Number },
  string: { multiline: false, toText: (v) => String(v ?? ''), fromText: (t) => t.trim() },
}

export function currentValue(field: SettingField): unknown {
  return field.value === undefined ? field.default : field.value
}

export type TextOutcome =
  | { kind: 'unchanged' }
  // An empty field goes back to the default.
  | { kind: 'reset' }
  | { kind: 'value'; value: unknown }
  | { kind: 'problem'; problem: string }

// What saving `text` in a text field does.
export function readText(field: SettingField, type: TextFieldType, text: string): TextOutcome {
  const format = TEXT_FORMATS[type]
  if (text === format.toText(currentValue(field))) {
    return { kind: 'unchanged' }
  }
  if (text.trim() === '' && (type === 'number' || type === 'string')) {
    return { kind: 'reset' }
  }
  const value = format.fromText(text)
  if (typeof value === 'string' && type === 'map') {
    return { kind: 'problem', problem: value }
  }
  if (field.pattern && typeof value === 'string' && !new RegExp(field.pattern).test(value)) {
    return { kind: 'problem', problem: field.patternMessage ?? 'This value has the wrong format.' }
  }
  if (type === 'number') {
    const number = value as number
    if (
      !Number.isFinite(number) ||
      (field.minimum !== undefined && number < field.minimum) ||
      (field.maximum !== undefined && number > field.maximum)
    ) {
      return {
        kind: 'problem',
        problem: `Enter a number from ${field.minimum ?? '…'} to ${field.maximum ?? '…'}.`,
      }
    }
  }
  return { kind: 'value', value }
}

// In the repository mode a field shows the override, with the global value as its fallback.
export function repositoryField(field: SettingField, repository: SettingsRepository): SettingField {
  return { ...field, value: repository.values[field.key], default: currentValue(field) }
}

export function matchesQuery(field: SettingField, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return (
    !needle ||
    `${field.title} ${field.key} ${field.description} ${(field.shortcuts ?? []).map((s) => s.title).join(' ')}`
      .toLowerCase()
      .includes(needle)
  )
}

// The user's own keys from the setting's value, by command id.
export function ownShortcuts(value: unknown): Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {}
}

export function shortcutOf(action: ShortcutField, own: Readonly<Record<string, string>>): string {
  return own[action.id] ?? action.default
}

// For each command, the titles of the other commands bound to the same keys.
export function shortcutClashes(
  actions: readonly ShortcutField[],
  own: Readonly<Record<string, string>>,
  platform: string,
): Map<string, string[]> {
  const byKey = new Map<string, ShortcutField[]>()
  for (const action of actions) {
    const normal = normalizeAccelerator(shortcutOf(action, own), platform)
    if (normal) {
      byKey.set(normal, [...(byKey.get(normal) ?? []), action])
    }
  }
  const clashes = new Map<string, string[]>()
  for (const group of byKey.values()) {
    for (const action of group) {
      const others = group.filter((other) => other.id !== action.id).map((other) => other.title)
      if (others.length > 0) {
        clashes.set(action.id, others)
      }
    }
  }
  return clashes
}

// The setting after binding `key` to `action`. Keys equal to the default are not stored.
export function withShortcut(
  own: Readonly<Record<string, string>>,
  action: ShortcutField,
  key: string | null,
): Record<string, string> {
  const rest = Object.fromEntries(Object.entries(own).filter(([id]) => id !== action.id))
  return key === null || key === action.default ? rest : { ...rest, [action.id]: key }
}
