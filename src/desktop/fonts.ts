import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { FontSpec, Fonts } from '../../shared/desktopProtocol'
import { hostSpawn } from '../util/hostProcess'

export interface SystemFont {
  family: string
  // A CSS font weight, like '500'.
  weight: string
  // In CSS pixels.
  size: number
}

export const EDITOR_FONT_FAMILY = 'desktop.editor.fontFamily'
export const EDITOR_FONT_SIZE = 'desktop.editor.fontSize'
export const EDITOR_FONT_WEIGHT = 'desktop.editor.fontWeight'
export const TERMINAL_FONT_FAMILY = 'desktop.terminal.fontFamily'
export const TERMINAL_FONT_SIZE = 'desktop.terminal.fontSize'

const DEFAULT_EDITOR_SIZE = 13
const DEFAULT_TERMINAL_SIZE = 13

const WEIGHTS: Record<string, string> = {
  thin: '100',
  hairline: '100',
  extralight: '200',
  ultralight: '200',
  light: '300',
  semilight: '350',
  book: '400',
  regular: '400',
  normal: '400',
  medium: '500',
  semibold: '600',
  demibold: '600',
  bold: '700',
  extrabold: '800',
  ultrabold: '800',
  black: '900',
  heavy: '900',
}

const SLANTS = new Set(['italic', 'oblique'])

// Pango names a size in points. CSS pixels are 4/3 of a point.
function pointsToPixels(points: number): number {
  return Math.round(((points * 4) / 3) * 100) / 100
}

// Reads a Pango font name like "FiraCode Nerd Font Mono Medium 11", as GNOME stores fonts.
export function parsePangoFont(text: string): SystemFont | null {
  const words = text.trim().replace(/^'|'$/g, '').trim().split(/\s+/).filter(Boolean)
  const points = Number(words.at(-1))
  if (words.length < 2 || !Number.isFinite(points) || points <= 0) {
    return null
  }
  const names = words.slice(0, -1)
  let weight = '400'
  while (names.length > 1) {
    const word = (names.at(-1) ?? '').toLowerCase()
    if (SLANTS.has(word)) {
      names.pop()
    } else if (word in WEIGHTS) {
      weight = WEIGHTS[word] ?? weight
      names.pop()
    } else {
      break
    }
  }
  return { family: names.join(' '), weight, size: pointsToPixels(points) }
}

// Reads KDE's `fixed` font, like "Hack,10,-1,5,50,0,0,0,0,0" (Qt 5) or with a style name (Qt 6).
export function parseKdeFont(text: string): SystemFont | null {
  const parts = text.split(',')
  const family = parts[0]?.trim()
  const points = Number(parts[1])
  if (!family || !Number.isFinite(points) || points <= 0) {
    return null
  }
  const style = parts.length > 10 ? parts.at(-1)?.trim().toLowerCase() : undefined
  const weight = (style && WEIGHTS[style.replace(/\s+/g, '')]) || '400'
  return { family, weight, size: pointsToPixels(points) }
}

// A CSS font-family list. A single name gets quotes and a monospace fallback.
export function cssFamily(value: string): string {
  const trimmed = value.trim()
  if (trimmed.includes(',') || trimmed.startsWith("'") || trimmed.startsWith('"')) {
    return trimmed
  }
  return `'${trimmed.replace(/'/g, "\\'")}', monospace`
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function size(value: unknown): number | undefined {
  return typeof value === 'number' && value >= 6 && value <= 72 ? value : undefined
}

// The fonts of the diff view and the terminal: the settings, or else the system's.
export function resolveFonts(
  values: Readonly<Record<string, unknown>>,
  system: SystemFont | null,
): Fonts {
  const systemFamily = system ? cssFamily(system.family) : 'monospace'
  const editorFamily = text(values[EDITOR_FONT_FAMILY])
  const weightSetting = text(values[EDITOR_FONT_WEIGHT])
  const weight =
    weightSetting && weightSetting !== 'system' ? weightSetting : (system?.weight ?? 'normal')
  const editor: FontSpec = {
    family: editorFamily ? cssFamily(editorFamily) : systemFamily,
    size: size(values[EDITOR_FONT_SIZE]) ?? DEFAULT_EDITOR_SIZE,
    weight,
  }
  const terminalFamily = text(values[TERMINAL_FONT_FAMILY])
  const terminal: FontSpec = {
    family: terminalFamily ? cssFamily(terminalFamily) : editor.family,
    size:
      size(values[TERMINAL_FONT_SIZE]) ??
      (editorFamily ? editor.size : (system?.size ?? DEFAULT_TERMINAL_SIZE)),
    weight,
  }
  return { editor, terminal }
}

type Read = (command: string, args: string[]) => Promise<string | null>

const readCommand: Read = (command, args) => {
  const host = hostSpawn(command, args)
  return new Promise((resolve) => {
    execFile(host.command, host.args, { env: host.env, timeout: 3_000 }, (error, stdout) =>
      resolve(error ? null : stdout.trim()),
    )
  })
}

async function gsetting(read: Read, schema: string, key: string): Promise<string | null> {
  return read('gsettings', ['get', schema, key])
}

// Ptyxis is Fedora's and GNOME's terminal. It keeps its own font unless it follows the system.
async function ptyxisFont(read: Read): Promise<SystemFont | null> {
  if ((await gsetting(read, 'org.gnome.Ptyxis', 'use-system-font')) !== 'false') {
    return null
  }
  return parsePangoFont((await gsetting(read, 'org.gnome.Ptyxis', 'font-name')) ?? '')
}

async function gnomeTerminalFont(read: Read): Promise<SystemFont | null> {
  const profile = (await gsetting(read, 'org.gnome.Terminal.ProfilesList', 'default'))?.replace(
    /'/g,
    '',
  )
  if (!profile) {
    return null
  }
  const schema = `org.gnome.Terminal.Legacy.Profile:/org/gnome/terminal/legacy/profiles:/:${profile}/`
  if ((await gsetting(read, schema, 'use-system-font')) !== 'false') {
    return null
  }
  return parsePangoFont((await gsetting(read, schema, 'font')) ?? '')
}

async function gnomeMonospace(read: Read): Promise<SystemFont | null> {
  return parsePangoFont(
    (await gsetting(read, 'org.gnome.desktop.interface', 'monospace-font-name')) ?? '',
  )
}

async function kdeFixed(home: string): Promise<SystemFont | null> {
  try {
    const globals = await readFile(join(home, '.config', 'kdeglobals'), 'utf8')
    const line = /^fixed=(.+)$/m.exec(globals)?.[1]
    return line ? parseKdeFont(line) : null
  } catch {
    return null
  }
}

// The font the user sees in their terminal: the terminal's own, else the system's monospace font.
export async function detectSystemFont(
  read: Read = readCommand,
  home: string = homedir(),
): Promise<SystemFont | null> {
  if (process.platform !== 'linux') {
    return null
  }
  return (
    (await ptyxisFont(read)) ??
    (await gnomeTerminalFont(read)) ??
    (await gnomeMonospace(read)) ??
    (await kdeFixed(home))
  )
}
