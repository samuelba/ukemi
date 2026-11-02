import type { SettingField, SettingOption } from '../../shared/desktopProtocol'
import { isRepositoryKey } from '../../shared/settingsScope'
import packageJson from '../../package.json'
import {
  EDITOR_FONT_FAMILY,
  EDITOR_FONT_SIZE,
  EDITOR_FONT_WEIGHT,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
} from './fonts'
import { RESTORE_REPOSITORIES, THEME } from './startup'

interface PropertySchema {
  type?: string
  enum?: string[]
  enumDescriptions?: string[]
  default?: unknown
  description?: string
  markdownDescription?: string
  minimum?: number
  maximum?: number
  pattern?: string
  patternErrorMessage?: string
}

const PREFIX = 'ukemi.'

// Settings that only change how Ukemi sits inside an editor.
const EDITOR_ONLY = new Set([
  'addJjToTerminalPath',
  'showSourceControl',
  'showInPanel',
  'showEditorTitleDiff',
  'followActiveEditor',
])

const GROUPS: ReadonlyArray<readonly [string, (key: string) => boolean]> = [
  ['General', (key) => key === 'jjPath' || key.startsWith('repoScan')],
  ['Workspaces', (key) => key.startsWith('workspaces.')],
  ['Fetching', (key) => key.startsWith('autoFetch.')],
  ['GitHub and GitLab', (key) => /^(github|gitlab|forge)\./.test(key)],
  ['Descriptions', (key) => key.startsWith('describeSuggest.')],
  ['Graph', () => true],
]

// Settings of the standalone app alone. VS Code never sees them, so they are not in package.json.
const DESKTOP_FIELDS: readonly Omit<
  SettingField,
  'value' | 'isRepositoryScoped' | 'overriddenIn'
>[] = [
  {
    key: RESTORE_REPOSITORIES,
    group: 'General',
    title: 'Reopen Repositories',
    description:
      'Reopen the repositories of the last session when Ukemi starts. Repositories named on the command line always open.',
    type: 'boolean',
    default: true,
  },
  {
    key: THEME,
    group: 'General',
    title: 'Theme',
    description: 'The colors of Ukemi: light washi paper, dark sumi ink, or what the system uses.',
    type: 'enum',
    options: [
      { value: 'system', description: 'Follow the light or dark setting of the system.' },
      { value: 'light', description: 'Always light.' },
      { value: 'dark', description: 'Always dark.' },
    ],
    default: 'system',
  },
  {
    key: EDITOR_FONT_FAMILY,
    group: 'Fonts',
    title: 'Editor: Font Family',
    description:
      "The font of diffs, change ids and paths, as a CSS list like `'FiraCode Nerd Font Mono', monospace`. Empty uses the font of your terminal, or else the system's monospace font.",
    type: 'string',
    default: '',
  },
  {
    key: EDITOR_FONT_SIZE,
    group: 'Fonts',
    title: 'Editor: Font Size',
    description: 'The font size of diffs, in pixels.',
    type: 'number',
    minimum: 6,
    maximum: 72,
    default: 13,
  },
  {
    key: EDITOR_FONT_WEIGHT,
    group: 'Fonts',
    title: 'Editor: Font Weight',
    description: 'The weight of the editor and terminal fonts.',
    type: 'enum',
    options: [
      { value: 'system', description: 'The weight of your terminal or system font, like Medium.' },
      { value: 'normal' },
      { value: '300', description: 'Light' },
      { value: '500', description: 'Medium' },
      { value: '600', description: 'Semibold' },
      { value: 'bold' },
    ],
    default: 'system',
  },
  {
    key: TERMINAL_FONT_FAMILY,
    group: 'Fonts',
    title: 'Terminal: Font Family',
    description: 'The font of the terminals in the panel. Empty uses the editor font.',
    type: 'string',
    default: '',
  },
  {
    key: TERMINAL_FONT_SIZE,
    group: 'Fonts',
    title: 'Terminal: Font Size',
    description:
      'The font size of the terminals, in pixels. Empty uses the size of your terminal or system font.',
    type: 'number',
    minimum: 6,
    maximum: 72,
    default: null,
  },
]

const GROUP_ORDER = [
  'General',
  'Fonts',
  'Graph',
  'Descriptions',
  'Workspaces',
  'Fetching',
  'GitHub and GitLab',
]

function groupOf(key: string): string {
  return GROUPS.find(([, matches]) => matches(key))?.[0] ?? 'Graph'
}

function words(segment: string): string {
  const spaced = segment.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// `autoFetch.enabled` reads as "Auto Fetch: Enabled", as in the VS Code settings editor.
export function settingTitle(key: string): string {
  const parts = key.split('.')
  const last = parts.pop() ?? key
  return parts.length > 0 ? `${parts.map(words).join(' › ')}: ${words(last)}` : words(last)
}

function fieldType(schema: PropertySchema): SettingField['type'] {
  if (schema.enum) {
    return 'enum'
  }
  switch (schema.type) {
    case 'boolean':
      return 'boolean'
    case 'integer':
    case 'number':
      return 'number'
    case 'array':
      return 'list'
    case 'object':
      return 'map'
    default:
      return 'string'
  }
}

function options(schema: PropertySchema): SettingOption[] | undefined {
  return schema.enum?.map((value, index) => {
    const description = schema.enumDescriptions?.[index]
    return description ? { value, description } : { value }
  })
}

// The form fields of the settings view, with the values the user has set. `overriddenIn`
// names the repositories that override a key.
export function settingFields(
  values: Readonly<Record<string, unknown>>,
  overriddenIn: (key: string) => string[] = () => [],
): SettingField[] {
  const properties = packageJson.contributes.configuration.properties as Record<
    string,
    PropertySchema
  >
  const fields = Object.entries(properties)
    .map(([name, schema]) => ({ key: name.slice(PREFIX.length), schema }))
    .filter(({ key }) => !EDITOR_ONLY.has(key))
    .map(({ key, schema }): SettingField => {
      const field: SettingField = {
        key,
        group: groupOf(key),
        title: settingTitle(key),
        description: schema.description ?? schema.markdownDescription ?? '',
        type: fieldType(schema),
        default: schema.default,
        value: values[key],
        isRepositoryScoped: isRepositoryKey(key),
        overriddenIn: isRepositoryKey(key) ? overriddenIn(key) : [],
      }
      const choices = options(schema)
      return {
        ...field,
        ...(choices ? { options: choices } : {}),
        ...(schema.minimum !== undefined ? { minimum: schema.minimum } : {}),
        ...(schema.maximum !== undefined ? { maximum: schema.maximum } : {}),
        ...(schema.pattern ? { pattern: schema.pattern } : {}),
        ...(schema.patternErrorMessage ? { patternMessage: schema.patternErrorMessage } : {}),
      }
    })
  const desktop = DESKTOP_FIELDS.map((field) => ({
    ...field,
    value: values[field.key],
    isRepositoryScoped: false,
    overriddenIn: [],
  }))
  const all = [...desktop, ...fields]
  return GROUP_ORDER.flatMap((group) => all.filter((field) => field.group === group))
}
