import { useEffect, useMemo, useState } from 'react'
import {
  asIconThemeDocument,
  flattenIconTheme,
  type FileIconTheme,
} from '../../../shared/fileIconTheme'
import languages from './fileIcons/languages.json'
import setiFont from './fileIcons/seti.woff'
import setiTheme from './fileIcons/vs-seti-icon-theme.json'

// The app has no VS Code icon theme to borrow, so it ships VS Code's Seti theme. Seti picks many
// icons by language id, and languages.json maps names and extensions to the ids VS Code uses.
function bundledFileIconTheme(isDark: boolean): FileIconTheme | null {
  const document = asIconThemeDocument(setiTheme)
  if (!document) {
    return null
  }
  return flattenIconTheme(document, isDark ? 'dark' : 'light', {
    languages,
    fontUri: () => setiFont,
    iconUri: () => '',
  })
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

// Follows the system theme, as the page's colors do.
export function useBundledFileIcons(): FileIconTheme | null {
  const [isDark, setIsDark] = useState(() => window.matchMedia(DARK_QUERY).matches)
  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY)
    const update = () => setIsDark(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return useMemo(() => bundledFileIconTheme(isDark), [isDark])
}
