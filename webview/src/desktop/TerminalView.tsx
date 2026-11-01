import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import type {
  DesktopHostMessage,
  DesktopRendererMessage,
  FontSpec,
} from '../../../shared/desktopProtocol'
import { postMessage } from '../shared/hostApi'
import { useHostListener } from '../shared/hooks'

function send(message: DesktopRendererMessage): void {
  postMessage(message)
}

// The terminal in the app's palette. The ANSI colors lean toward the washi and sumi tones.
function readTheme(): ITheme {
  const style = getComputedStyle(document.documentElement)
  const token = (name: string) => style.getPropertyValue(name).trim()
  const isDark = document.documentElement.classList.contains('vscode-dark')
  return {
    background: token('--vscode-editor-background'),
    foreground: token('--vscode-foreground'),
    cursor: token('--shu-ink'),
    cursorAccent: token('--vscode-editor-background'),
    selectionBackground: isDark ? 'rgba(224, 180, 76, 0.3)' : 'rgba(201, 154, 46, 0.3)',
    black: isDark ? '#3a3631' : '#1f1d1a',
    red: isDark ? '#ff8a65' : '#c8431e',
    green: isDark ? '#8fc47b' : '#4f7a3c',
    yellow: isDark ? '#e0b44c' : '#9a6c00',
    blue: isDark ? '#9aa3f0' : '#3b44a0',
    magenta: isDark ? '#d98bd0' : '#8e4f86',
    cyan: isDark ? '#78b6d6' : '#2f6f8f',
    white: isDark ? '#ece6da' : '#5d574d',
    brightBlack: isDark ? '#7d7668' : '#8a8377',
    brightRed: isDark ? '#ffab91' : '#e4572e',
    brightGreen: isDark ? '#a9d494' : '#5f8a4a',
    brightYellow: isDark ? '#f0cb72' : '#c99a2e',
    brightBlue: isDark ? '#b9c0f5' : '#5560c4',
    brightMagenta: isDark ? '#e7a9e0' : '#a8659f',
    brightCyan: isDark ? '#9ccbe3' : '#3d88ad',
    brightWhite: isDark ? '#fffaf0' : '#1f1d1a',
  }
}

// One shell. It starts once the view knows its size, and follows the panel's size afterward.
// xterm measures its cells once per font, so the font has to be loaded before it is set.
async function applyFont(term: Terminal, font: FontSpec): Promise<void> {
  try {
    await document.fonts.load(`${font.weight} ${font.size}px ${font.family}`)
  } catch {
    // An unknown font falls back to the next in the list.
  }
  term.options.fontFamily = font.family
  term.options.fontSize = font.size
  term.options.fontWeight = font.weight as Terminal['options']['fontWeight']
}

export function TerminalView({
  id,
  isVisible,
  font,
}: {
  id: string
  isVisible: boolean
  font: FontSpec
}) {
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)

  useEffect(() => {
    const element = host.current
    if (!element) {
      return
    }
    const term = new Terminal({
      fontFamily: font.family,
      fontSize: font.size,
      fontWeight: font.weight as Terminal['options']['fontWeight'],
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5_000,
      allowProposedApi: false,
      theme: readTheme(),
    })
    const fitter = new FitAddon()
    term.loadAddon(fitter)
    term.open(element)
    terminal.current = term
    fit.current = fitter
    fitter.fit()
    send({ type: 'desktop.terminalStart', id, cols: term.cols, rows: term.rows })
    const input = term.onData((data) => send({ type: 'desktop.terminalInput', id, data }))
    const resized = term.onResize(({ cols, rows }) =>
      send({ type: 'desktop.terminalResize', id, cols, rows }),
    )

    const observer = new ResizeObserver(() => {
      if (element.offsetWidth > 0 && element.offsetHeight > 0) {
        fitter.fit()
      }
    })
    observer.observe(element)
    // The theme follows the app's: the class on <html> changes with light and dark.
    const themes = new MutationObserver(() => {
      term.options.theme = readTheme()
    })
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    return () => {
      observer.disconnect()
      themes.disconnect()
      input.dispose()
      resized.dispose()
      term.dispose()
      terminal.current = null
    }
  }, [id])

  useEffect(() => {
    const term = terminal.current
    if (term) {
      void applyFont(term, font).then(() => fit.current?.fit())
    }
  }, [font])

  useEffect(() => {
    if (isVisible) {
      fit.current?.fit()
      terminal.current?.focus()
    }
  }, [isVisible])

  useHostListener<DesktopHostMessage>((message) => {
    if (message.type === 'desktop.terminalData' && message.id === id) {
      terminal.current?.write(message.data)
    } else if (message.type === 'desktop.terminalExit' && message.id === id) {
      terminal.current?.write(`\r\n\x1b[2m[The shell exited with code ${message.code}.]\x1b[0m\r\n`)
    }
  })

  return <div className="terminal-view" ref={host} hidden={!isVisible} />
}
