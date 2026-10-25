import { sep } from 'node:path'
import * as vscode from 'vscode'
import {
  asIconThemeDocument,
  flattenIconTheme,
  type FileIconTheme,
  type IconVariant,
  type LanguageAssociations,
} from '../../shared/fileIconTheme'

interface IconThemeContribution {
  extensionUri: vscode.Uri
  path: string
}

interface LanguageContribution {
  id: string
  extensions: string[]
  filenames: string[]
}

export function iconThemeResourceRoots(extensionUri: vscode.Uri): vscode.Uri[] {
  const roots = [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')]
  const seen = new Set(roots.map((root) => root.toString()))
  for (const extension of vscode.extensions.all) {
    const themes = extension.packageJSON?.contributes?.iconThemes
    if (!Array.isArray(themes) || themes.length === 0) {
      continue
    }
    const key = extension.extensionUri.toString()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    roots.push(extension.extensionUri)
  }
  return roots
}

export async function loadFileIconTheme(webview: vscode.Webview): Promise<FileIconTheme | null> {
  const themeId = configuredThemeId()
  if (!themeId) {
    return null
  }
  const contribution = findIconTheme(themeId)
  if (!contribution) {
    return null
  }
  const root = contribution.extensionUri
  const themeUri = containedUri(root, root, contribution.path)
  if (!themeUri) {
    return null
  }
  const bytes = await vscode.workspace.fs.readFile(themeUri)
  const document = asIconThemeDocument(parseJsonText(new TextDecoder('utf-8').decode(bytes)))
  if (!document) {
    return null
  }
  const themeDir = vscode.Uri.joinPath(themeUri, '..')
  const uri = (directory: vscode.Uri, relativePath: string) => {
    const target = containedUri(root, directory, relativePath)
    return target ? webview.asWebviewUri(target).toString() : ''
  }
  return flattenIconTheme(document, colorVariant(), {
    languages: languageAssociations(),
    fontUri: (fontPath) => uri(themeDir, fontPath),
    iconUri: (iconPath) => uri(themeDir, iconPath),
  })
}

function configuredThemeId(): string | undefined {
  const themeId = vscode.workspace.getConfiguration('workbench').get<string | null>('iconTheme')
  if (typeof themeId !== 'string' || themeId.length === 0) {
    return undefined
  }
  return themeId
}

function colorVariant(): IconVariant {
  const kind = vscode.window.activeColorTheme.kind
  if (kind === vscode.ColorThemeKind.Light) {
    return 'light'
  }
  if (
    kind === vscode.ColorThemeKind.HighContrast ||
    kind === vscode.ColorThemeKind.HighContrastLight
  ) {
    return 'highContrast'
  }
  return 'dark'
}

function findIconTheme(themeId: string): IconThemeContribution | undefined {
  for (const extension of vscode.extensions.all) {
    const themes = extension.packageJSON?.contributes?.iconThemes
    if (!Array.isArray(themes)) {
      continue
    }
    for (const theme of themes) {
      if (isThemeContribution(theme) && theme.id === themeId) {
        return { extensionUri: extension.extensionUri, path: theme.path }
      }
    }
  }
  return undefined
}

function isThemeContribution(value: unknown): value is { id: string; path: string } {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const theme = value as { id?: unknown; path?: unknown }
  return typeof theme.id === 'string' && typeof theme.path === 'string' && theme.path.length > 0
}

function languageAssociations(): LanguageAssociations {
  const user = emptyLanguages()
  const builtin = emptyLanguages()
  for (const extension of vscode.extensions.all) {
    const target = isBuiltinExtension(extension.extensionPath) ? builtin : user
    for (const language of languageContributions(extension)) {
      for (const filename of language.filenames) {
        target.filenames[filename.toLowerCase()] = language.id
      }
      for (const extensionName of language.extensions) {
        const key = extensionName.replace(/^\./, '').toLowerCase()
        if (key.length > 0) {
          target.extensions[key] = language.id
        }
      }
    }
  }
  // A user extension that claims the same name wins, as it does in the editor.
  return {
    extensions: { ...builtin.extensions, ...user.extensions },
    filenames: { ...builtin.filenames, ...user.filenames },
  }
}

function emptyLanguages(): LanguageAssociations {
  return { extensions: {}, filenames: {} }
}

function isBuiltinExtension(extensionPath: string): boolean {
  const root = `${vscode.env.appRoot}${sep}extensions${sep}`
  const normalized = extensionPath.endsWith(sep) ? extensionPath : `${extensionPath}${sep}`
  return normalized.startsWith(root)
}

function languageContributions(extension: vscode.Extension<unknown>): LanguageContribution[] {
  const languages = extension.packageJSON?.contributes?.languages
  if (!Array.isArray(languages)) {
    return []
  }
  const result: LanguageContribution[] = []
  for (const language of languages) {
    const contribution = readLanguage(language)
    if (contribution) {
      result.push(contribution)
    }
  }
  return result
}

function readLanguage(value: unknown): LanguageContribution | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const language = value as { id?: unknown; extensions?: unknown; filenames?: unknown }
  if (typeof language.id !== 'string' || language.id.length === 0) {
    return undefined
  }
  return {
    id: language.id.toLowerCase(),
    extensions: stringList(language.extensions),
    filenames: stringList(language.filenames),
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function containedUri(
  root: vscode.Uri,
  directory: vscode.Uri,
  relativePath: string,
): vscode.Uri | undefined {
  const parts = relativePath.split(/[/\\]+/).filter((part) => part.length > 0 && part !== '.')
  const target = vscode.Uri.joinPath(directory, ...parts)
  const rootPath = root.fsPath.endsWith(sep) ? root.fsPath : `${root.fsPath}${sep}`
  if (target.fsPath !== root.fsPath && !target.fsPath.startsWith(rootPath)) {
    return undefined
  }
  return target
}

function parseJsonText(text: string): unknown {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  try {
    return JSON.parse(source) as unknown
  } catch {
    return JSON.parse(stripJsonComments(source)) as unknown
  }
}

function stripJsonComments(text: string): string {
  let result = ''
  let index = 0
  while (index < text.length) {
    const char = text.charAt(index)
    if (char === '"') {
      const end = endOfString(text, index)
      result += text.slice(index, end)
      index = end
      continue
    }
    if (char === '/' && text.charAt(index + 1) === '/') {
      index += 2
      while (index < text.length && text.charAt(index) !== '\n') {
        index += 1
      }
      continue
    }
    if (char === '/' && text.charAt(index + 1) === '*') {
      index += 2
      while (
        index < text.length &&
        !(text.charAt(index) === '*' && text.charAt(index + 1) === '/')
      ) {
        index += 1
      }
      index = Math.min(text.length, index + 2)
      continue
    }
    result += char
    index += 1
  }
  return result.replace(/,\s*([}\]])/g, '$1')
}

function endOfString(text: string, start: number): number {
  let index = start + 1
  while (index < text.length) {
    if (text.charAt(index) === '\\') {
      index += 2
      continue
    }
    if (text.charAt(index) === '"') {
      return index + 1
    }
    index += 1
  }
  return text.length
}
