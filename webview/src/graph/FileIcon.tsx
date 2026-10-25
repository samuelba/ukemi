import { createContext, useContext, useEffect } from 'react'
import { iconForPath, type FileIconFont, type FileIconTheme } from '../../../shared/fileIconTheme'

export const FileIconThemeContext = createContext<FileIconTheme | null>(null)

export function FileIconFonts({ theme }: { theme: FileIconTheme | null }) {
  const css = theme ? fontFaceCss(theme.fonts) : ''
  useEffect(() => {
    if (!css) {
      return
    }
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
    return () => {
      style.remove()
    }
  }, [css])
  return null
}

export function FileTypeIcon({ path }: { path: string }) {
  const theme = useContext(FileIconThemeContext)
  if (!theme) {
    return null
  }
  const icon = iconForPath(theme, path)
  if (icon?.iconUri) {
    return <img className="file-icon" src={icon.iconUri} alt="" />
  }
  if (!icon?.fontCharacter) {
    return null
  }
  const font = theme.fonts.find((item) => item.id === icon.fontId)
  return (
    <span
      className="file-icon"
      style={{
        color: icon.fontColor,
        fontFamily: font ? `"${font.id.replaceAll('"', '')}"` : undefined,
        fontSize: font?.size,
      }}
      aria-hidden="true"
    >
      {icon.fontCharacter}
    </span>
  )
}

function fontFaceCss(fonts: readonly FileIconFont[]): string {
  return fonts
    .map((font) => {
      const family = cssString(font.id)
      const src = `url(${cssString(font.uri)}) format(${cssString(font.format)})`
      const weight = cssToken(font.weight, 'normal')
      const style = cssToken(font.style, 'normal')
      return `@font-face{font-family:${family};src:${src};font-weight:${weight};font-style:${style};font-display:block;}`
    })
    .join('\n')
}

function cssString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '')}"`
}

function cssToken(value: string, fallback: string): string {
  return /^[\w .%+-]+$/.test(value) ? value : fallback
}
