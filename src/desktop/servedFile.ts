import { existsSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, normalize, relative, sep } from 'node:path'

const PAGE_FOLDERS = ['desktop', 'webview']
const PAGE_TYPES = new Set(['.html', '.js', '.css', '.ttf', '.woff', '.woff2'])
// Bundles of the main process, which no page loads.
const MAIN_BUNDLES = new Set([join('desktop', 'main.js'), join('desktop', 'preload.js')])

function isPageFile(inside: string, isDevelopment: boolean): boolean {
  const folder = inside.split(sep)[0] ?? ''
  if (!PAGE_FOLDERS.includes(folder) || inside === folder) {
    return false
  }
  if (extname(inside) === '.map') {
    return isDevelopment && isPageFile(inside.slice(0, -'.map'.length), false)
  }
  return PAGE_TYPES.has(extname(inside)) && !MAIN_BUNDLES.has(inside)
}

// Serves only the files the pages load, so a page cannot read anything else on disk or in the
// bundle.
export function servedFile(dist: string, url: URL, isDevelopment: boolean): string | null {
  const path = normalize(join(dist, decodeURIComponent(url.pathname)))
  const inside = relative(dist, path)
  if (inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside)) {
    return null
  }
  if (!isPageFile(inside, isDevelopment)) {
    return null
  }
  return existsSync(path) && statSync(path).isFile() ? path : null
}
