export type IconVariant = 'dark' | 'light' | 'highContrast'

export interface FileIcon {
  fontCharacter?: string
  fontColor?: string
  fontId?: string
  iconUri?: string
}

export interface FileIconFont {
  id: string
  uri: string
  format: string
  weight: string
  style: string
  size: string
}

export interface LanguageAssociations {
  extensions: Record<string, string>
  filenames: Record<string, string>
}

export interface FileIconTheme {
  fonts: FileIconFont[]
  icons: Record<string, FileIcon>
  file: string
  fileNames: Record<string, string>
  fileExtensions: Record<string, string>
  languageIds: Record<string, string>
  languages: LanguageAssociations
}

export interface RawIconDefinition {
  fontCharacter?: string
  fontColor?: string
  fontId?: string
  iconPath?: string
}

export interface RawIconAssociations {
  file?: string
  fileExtensions?: Record<string, string>
  fileNames?: Record<string, string>
  languageIds?: Record<string, string>
  iconDefinitions?: Record<string, RawIconDefinition>
}

export interface RawIconThemeDocument extends RawIconAssociations {
  fonts?: RawIconFont[]
  light?: RawIconAssociations
  highContrast?: RawIconAssociations
}

export interface RawIconFont {
  id?: string
  src?: { path?: string; format?: string }[]
  weight?: string | number
  style?: string
  size?: string
}

export interface FlattenIconThemeOptions {
  languages: LanguageAssociations
  fontUri: (fontPath: string) => string
  iconUri: (iconPath: string) => string
}

export function asIconThemeDocument(value: unknown): RawIconThemeDocument | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  return value as RawIconThemeDocument
}

// Theme JSON stores a private-use glyph as the six characters \E099.
export function parseFontCharacter(raw: string): string {
  if (raw.length === 1) {
    return raw
  }
  const hex =
    raw.startsWith('\\u') || raw.startsWith('\\U')
      ? raw.slice(2)
      : raw.startsWith('\\')
        ? raw.slice(1)
        : ''
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    return raw
  }
  const code = Number.parseInt(hex, 16)
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) {
    return raw
  }
  return String.fromCodePoint(code)
}

export function flattenIconTheme(
  document: RawIconThemeDocument,
  variant: IconVariant,
  options: FlattenIconThemeOptions,
): FileIconTheme {
  const overlay = association(variantSection(document, variant))
  const fonts = readFonts(document.fonts, options.fontUri)
  const defaultFontId = fonts[0]?.id
  return {
    fonts,
    icons: {
      ...readIcons(document.iconDefinitions, defaultFontId, options.iconUri),
      ...readIcons(overlay.iconDefinitions, defaultFontId, options.iconUri),
    },
    file: text(overlay.file, '') || text(document.file, ''),
    fileNames: { ...stringMap(document.fileNames), ...stringMap(overlay.fileNames) },
    fileExtensions: { ...stringMap(document.fileExtensions), ...stringMap(overlay.fileExtensions) },
    languageIds: { ...stringMap(document.languageIds), ...stringMap(overlay.languageIds) },
    languages: {
      extensions: stringMap(options.languages.extensions),
      filenames: stringMap(options.languages.filenames),
    },
  }
}

export function iconForPath(theme: FileIconTheme, path: string): FileIcon | undefined {
  const name = basename(path).toLowerCase()
  return (
    iconById(theme, theme.fileNames[name]) ??
    iconByExtension(theme, name) ??
    iconByLanguage(theme, name) ??
    iconById(theme, theme.file)
  )
}

function variantSection(
  document: RawIconThemeDocument,
  variant: IconVariant,
): RawIconAssociations | undefined {
  if (variant === 'light') {
    return document.light
  }
  if (variant === 'highContrast') {
    return document.highContrast
  }
  return undefined
}

function association(value: RawIconAssociations | undefined): RawIconAssociations {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  return value
}

function basename(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash < 0 ? path : path.slice(slash + 1)
}

function extensionCandidates(name: string): string[] {
  const parts = name.split('.')
  const candidates: string[] = []
  for (let index = 1; index < parts.length; index++) {
    const ext = parts.slice(index).join('.')
    if (ext.length > 0) {
      candidates.push(ext)
    }
  }
  return candidates
}

function iconByExtension(theme: FileIconTheme, name: string): FileIcon | undefined {
  for (const ext of extensionCandidates(name)) {
    const icon = iconById(theme, theme.fileExtensions[ext])
    if (icon) {
      return icon
    }
  }
  return undefined
}

function iconByLanguage(theme: FileIconTheme, name: string): FileIcon | undefined {
  const language = theme.languages.filenames[name] ?? languageByExtension(theme, name)
  if (!language) {
    return undefined
  }
  return iconById(theme, theme.languageIds[language])
}

function languageByExtension(theme: FileIconTheme, name: string): string | undefined {
  for (const ext of extensionCandidates(name)) {
    const language = theme.languages.extensions[ext]
    if (language) {
      return language
    }
  }
  return undefined
}

function iconById(theme: FileIconTheme, id: string | undefined): FileIcon | undefined {
  if (!id) {
    return undefined
  }
  const icon = theme.icons[id]
  if (!icon?.fontCharacter && !icon?.iconUri) {
    return undefined
  }
  return icon
}

function stringMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key.length > 0 && typeof entry === 'string' && entry.length > 0) {
      result[key.toLowerCase()] = entry
    }
  }
  return result
}

function text(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return fallback
}

function readFonts(value: unknown, fontUri: (fontPath: string) => string): FileIconFont[] {
  if (!Array.isArray(value)) {
    return []
  }
  const fonts: FileIconFont[] = []
  for (const entry of value) {
    const font = readFont(entry, fontUri)
    if (font) {
      fonts.push(font)
    }
  }
  return fonts
}

function readFont(value: unknown, fontUri: (fontPath: string) => string): FileIconFont | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const font = value as RawIconFont
  const id = text(font.id, '')
  const src = firstFontSource(font.src)
  const uri = src ? fontUri(src.path) : ''
  if (!id || !src || !uri) {
    return undefined
  }
  return {
    id,
    uri,
    format: src.format,
    weight: text(font.weight, 'normal'),
    style: text(font.style, 'normal'),
    size: text(font.size, '16px'),
  }
}

function firstFontSource(value: unknown): { path: string; format: string } | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const source = entry as { path?: unknown; format?: unknown }
    if (typeof source.path !== 'string' || source.path.length === 0) {
      continue
    }
    return {
      path: source.path,
      format: text(source.format, 'woff'),
    }
  }
  return undefined
}

function readIcons(
  value: unknown,
  defaultFontId: string | undefined,
  iconUri: (iconPath: string) => string,
): Record<string, FileIcon> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const icons: Record<string, FileIcon> = {}
  for (const [id, entry] of Object.entries(value)) {
    const icon = readIcon(entry, defaultFontId, iconUri)
    if (id.length > 0 && icon) {
      icons[id] = icon
    }
  }
  return icons
}

function readIcon(
  value: unknown,
  defaultFontId: string | undefined,
  iconUri: (iconPath: string) => string,
): FileIcon | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const definition = value as RawIconDefinition
  const icon: FileIcon = {}
  const character = text(definition.fontCharacter, '')
  if (character) {
    icon.fontCharacter = parseFontCharacter(character)
    icon.fontId = text(definition.fontId, '') || defaultFontId
  }
  const color = text(definition.fontColor, '')
  if (color) {
    icon.fontColor = color
  }
  const iconPath = text(definition.iconPath, '')
  const resolved = iconPath ? iconUri(iconPath) : ''
  if (resolved) {
    icon.iconUri = resolved
  }
  if (!icon.fontCharacter && !icon.iconUri) {
    return undefined
  }
  return icon
}
